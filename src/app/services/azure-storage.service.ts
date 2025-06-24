import { Injectable } from '@angular/core';
import { Observable, Subject, from, of, merge, Subscription } from 'rxjs';
import { environment } from '../../environments/environment';
import { concatMap, tap, finalize, catchError, mergeMap, map, takeUntil } from 'rxjs/operators';

export interface UploadProgress {
  percentage: number;
  status: 'uploading' | 'completed' | 'failed' | 'cancelled';
  error?: string;
  speed?: string; // Upload speed in MB/s
  timeRemaining?: string; // Estimated time remaining
}

@Injectable({
  providedIn: 'root'
})
export class AzureStorageService {
  private baseUrl: string;
  // Default chunk size: 8MB (increased from 4MB for better performance)
  private DEFAULT_CHUNK_SIZE = 8 * 1024 * 1024;
  // Threshold for using chunked upload: 100MB
  private readonly CHUNKED_UPLOAD_THRESHOLD = 100 * 1024 * 1024;
  // Maximum concurrent uploads
  private readonly MAX_CONCURRENT_CHUNKS = 3;
  private currentXHRs: XMLHttpRequest[] = [];
  private uploadCancelled$ = new Subject<void>();
  private activeSubscriptions: Subscription[] = [];

  constructor() {
    this.baseUrl = `https://${environment.azureStorage.accountName}.blob.core.windows.net/${environment.azureStorage.containerName}`;
  }

  uploadFile(file: File): Observable<UploadProgress> {
    this.resetCancelState();
    
    if (file.size > this.CHUNKED_UPLOAD_THRESHOLD) {
      return this.uploadLargeFile(file);
    } else {
      return this.uploadSmallFile(file);
    }
  }

  cancelUpload(): void {
    // Signal all observables to complete
    this.uploadCancelled$.next();
    
    // Abort all active XHR requests
    this.currentXHRs.forEach(xhr => {
      if (xhr && xhr.readyState !== 4) {
        xhr.abort();
      }
    });
    
    // Clear the array
    this.currentXHRs = [];
    
    // Unsubscribe from any active subscriptions
    this.activeSubscriptions.forEach(sub => {
      if (sub) {
        sub.unsubscribe();
      }
    });
    this.activeSubscriptions = [];
  }

  private resetCancelState(): void {
    // Complete previous subject if it exists
    this.uploadCancelled$.complete();
    // Create a new subject
    this.uploadCancelled$ = new Subject<void>();
    
    // Clear any existing XHRs and subscriptions
    this.currentXHRs = [];
    this.activeSubscriptions.forEach(sub => {
      if (sub) sub.unsubscribe();
    });
    this.activeSubscriptions = [];
  }

  private uploadSmallFile(file: File): Observable<UploadProgress> {
    const progress$ = new Subject<UploadProgress>();
    const blobName = `${Date.now()}-${file.name}`;
    const blobUrl = `${this.baseUrl}/${blobName}${environment.azureStorage.sasToken}`;

    const xhr = new XMLHttpRequest();
    this.currentXHRs.push(xhr);
    
    const startTime = Date.now();
    let lastLoaded = 0;
    let lastLoadedTime = startTime;
    let speed = '0 MB/s';
    
    // For time remaining smoothing
    const speedSamples: number[] = [];
    const MAX_SAMPLES = 5;

    xhr.upload.addEventListener('progress', (event) => {
      if (event.lengthComputable) {
        const percentage = Math.round((event.loaded / event.total) * 100);
        
        // Calculate upload speed
        const currentTime = Date.now();
        const timeElapsed = (currentTime - lastLoadedTime) / 1000; // seconds
        if (timeElapsed > 0.5) { // Update speed every 0.5 seconds
          const loadedSinceLast = event.loaded - lastLoaded; // bytes
          const speedMBps = (loadedSinceLast / timeElapsed) / (1024 * 1024);
          
          // Add to samples for smoothing
          speedSamples.push(speedMBps);
          if (speedSamples.length > MAX_SAMPLES) {
            speedSamples.shift();
          }
          
          // Calculate average speed
          const avgSpeed = speedSamples.reduce((sum, s) => sum + s, 0) / speedSamples.length;
          speed = `${avgSpeed.toFixed(2)} MB/s`;
          
          // Update for next calculation
          lastLoaded = event.loaded;
          lastLoadedTime = currentTime;
        }
        
        // Calculate time remaining with smoothing
        const totalElapsed = (currentTime - startTime) / 1000; // seconds
        const remainingBytes = event.total - event.loaded;
        
        // Use average speed for more stable time remaining calculation
        const avgSpeedBytesPerSec = speedSamples.length > 0 ? 
          (speedSamples.reduce((sum, s) => sum + s, 0) / speedSamples.length) * 1024 * 1024 :
          event.loaded / totalElapsed;
        
        const secondsRemaining = avgSpeedBytesPerSec > 0 ? remainingBytes / avgSpeedBytesPerSec : 0;
        const timeRemaining = this.formatTimeRemaining(secondsRemaining);
        
        progress$.next({
          percentage,
          status: 'uploading',
          speed,
          timeRemaining
        });
      }
    });

    xhr.addEventListener('load', () => {
      if (xhr.status === 201) {
        progress$.next({
          percentage: 100,
          status: 'completed'
        });
        progress$.complete();
      } else {
        progress$.next({
          percentage: 0,
          status: 'failed',
          error: `Upload failed with status: ${xhr.status}`
        });
        progress$.complete();
      }
      
      // Remove from active XHRs
      const index = this.currentXHRs.indexOf(xhr);
      if (index !== -1) {
        this.currentXHRs.splice(index, 1);
      }
    });

    xhr.addEventListener('error', () => {
      progress$.next({
        percentage: 0,
        status: 'failed',
        error: 'Network error occurred during upload'
      });
      progress$.complete();
      
      // Remove from active XHRs
      const index = this.currentXHRs.indexOf(xhr);
      if (index !== -1) {
        this.currentXHRs.splice(index, 1);
      }
    });
    
    xhr.addEventListener('abort', () => {
      progress$.next({
        percentage: 0,
        status: 'cancelled',
        error: 'Upload was cancelled'
      });
      progress$.complete();
      
      // Remove from active XHRs
      const index = this.currentXHRs.indexOf(xhr);
      if (index !== -1) {
        this.currentXHRs.splice(index, 1);
      }
    });

    xhr.open('PUT', blobUrl, true);
    xhr.setRequestHeader('x-ms-blob-type', 'BlockBlob');
    xhr.setRequestHeader('Content-Type', file.type);
    xhr.send(file);

    // Handle cancellation
    const subscription = this.uploadCancelled$.subscribe(() => {
      if (xhr && xhr.readyState !== 4) {
        xhr.abort();
      }
    });
    this.activeSubscriptions.push(subscription);

    return progress$.asObservable().pipe(
      takeUntil(this.uploadCancelled$)
    );
  }

  private uploadLargeFile(file: File): Observable<UploadProgress> {
    const progress$ = new Subject<UploadProgress>();
    const blobName = `${Date.now()}-${file.name}`;
    const blockIds: string[] = [];
    const chunkSize = this.DEFAULT_CHUNK_SIZE;
    const totalChunks = Math.ceil(file.size / chunkSize);
    let processedBytes = 0;
    let completedChunks = 0;
    const startTime = Date.now();
    let lastSpeedUpdateTime = startTime;
    let lastProcessedBytes = 0;
    let currentSpeed = '0 MB/s';
    
    // For time remaining smoothing
    const speedSamples: number[] = [];
    const MAX_SAMPLES = 5;
    
    // Performance monitoring
    const chunkTimes: number[] = [];
    
    // Generate block IDs
    for (let i = 0; i < totalChunks; i++) {
      // Block IDs must be the same length for all blocks
      const blockId = this.padBlockId(i);
      blockIds.push(blockId);
    }

    // Function to update progress with speed calculation
    const updateProgress = (newProcessedBytes: number) => {
      processedBytes = newProcessedBytes;
      const percentage = Math.round((processedBytes / file.size) * 100);
      
      // Calculate upload speed
      const now = Date.now();
      const timeElapsed = (now - lastSpeedUpdateTime) / 1000; // seconds
      if (timeElapsed >= 0.5) { // Update speed every 0.5 seconds
        const bytesUploaded = processedBytes - lastProcessedBytes;
        const speedMBps = (bytesUploaded / timeElapsed) / (1024 * 1024);
        
        // Add to samples for smoothing
        speedSamples.push(speedMBps);
        if (speedSamples.length > MAX_SAMPLES) {
          speedSamples.shift();
        }
        
        // Calculate average speed
        const avgSpeed = speedSamples.reduce((sum, s) => sum + s, 0) / speedSamples.length;
        currentSpeed = `${avgSpeed.toFixed(2)} MB/s`;
        
        // Update for next calculation
        lastProcessedBytes = processedBytes;
        lastSpeedUpdateTime = now;
      }
      
      // Calculate time remaining with smoothing
      const totalElapsed = (now - startTime) / 1000; // seconds
      const remainingBytes = file.size - processedBytes;
      
      // Use average speed for more stable time remaining calculation
      const avgBytesPerSecond = speedSamples.length > 0 ? 
        (speedSamples.reduce((sum, s) => sum + s, 0) / speedSamples.length) * 1024 * 1024 : 
        processedBytes / totalElapsed;
      
      const secondsRemaining = avgBytesPerSecond > 0 ? remainingBytes / avgBytesPerSecond : 0;
      const timeRemaining = this.formatTimeRemaining(secondsRemaining);
      
      progress$.next({
        percentage,
        status: 'uploading',
        speed: currentSpeed,
        timeRemaining
      });
    };

    // Function to upload a single chunk
    const uploadChunk = (chunkIndex: number): Observable<void> => {
      const chunkStartTime = Date.now();
      const start = chunkIndex * chunkSize;
      const end = Math.min(start + chunkSize, file.size);
      const chunk = file.slice(start, end);
      const blockId = blockIds[chunkIndex];

      return this.uploadBlock(blobName, blockId, chunk).pipe(
        tap(() => {
          const chunkEndTime = Date.now();
          chunkTimes.push(chunkEndTime - chunkStartTime);
          
          completedChunks++;
          const newProcessedBytes = Math.min(completedChunks * chunkSize, file.size);
          updateProgress(newProcessedBytes);
          
          // Adaptive chunk size based on network performance
          if (completedChunks === 5 && totalChunks > 10) {
            this.adaptChunkSize(chunkTimes);
          }
        }),
        catchError(error => {
          if (error.name === 'AbortError' || error.message === 'Upload cancelled') {
            return of(undefined);
          }
          
          // On error, retry the chunk up to 3 times with exponential backoff
          return this.retryWithBackoff(
            () => this.uploadBlock(blobName, blockId, chunk),
            3,
            1000
          );
        })
      );
    };

    // Function to commit blocks after all chunks are uploaded
    const commitBlocks = (): Observable<void> => {
      return this.commitBlocks(blobName, blockIds, file.type).pipe(
        tap(() => {
          progress$.next({
            percentage: 100,
            status: 'completed'
          });
          progress$.complete();
        }),
        catchError(error => {
          if (error.name === 'AbortError' || error.message === 'Upload cancelled') {
            progress$.next({
              percentage: 0,
              status: 'cancelled',
              error: 'Upload was cancelled'
            });
          } else {
            progress$.next({
              percentage: 0,
              status: 'failed',
              error: `Failed to commit blocks: ${error.message || 'Unknown error'}`
            });
          }
          progress$.complete();
          return of(undefined);
        })
      );
    };

    // Create an array of chunk indices
    const chunkIndices = Array.from({ length: totalChunks }, (_, i) => i);

    // Use mergeMap to upload chunks concurrently with a limit
    const subscription = from(chunkIndices).pipe(
      mergeMap(chunkIndex => uploadChunk(chunkIndex), this.MAX_CONCURRENT_CHUNKS),
      takeUntil(this.uploadCancelled$),
      finalize(() => {
        // After all chunks are uploaded or if cancelled
        if (!this.uploadCancelled$.closed) {
          commitBlocks().subscribe();
        }
      }),
      catchError(error => {
        if (error.name === 'AbortError' || error.message === 'Upload cancelled') {
          progress$.next({
            percentage: 0,
            status: 'cancelled',
            error: 'Upload was cancelled'
          });
        } else {
          progress$.next({
            percentage: 0,
            status: 'failed',
            error: `Upload failed: ${error.message || 'Unknown error'}`
          });
        }
        progress$.complete();
        return of(undefined);
      })
    ).subscribe();
    
    this.activeSubscriptions.push(subscription);

    return progress$.asObservable().pipe(
      takeUntil(this.uploadCancelled$)
    );
  }

  private uploadBlock(blobName: string, blockId: string, content: Blob): Observable<void> {
    return new Observable<void>(observer => {
      const encodedBlockId = btoa(blockId); // Base64 encode the block ID
      const blockUrl = `${this.baseUrl}/${blobName}${environment.azureStorage.sasToken}&comp=block&blockid=${encodedBlockId}`;
      
      const xhr = new XMLHttpRequest();
      this.currentXHRs.push(xhr);
      
      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          observer.next();
          observer.complete();
        } else {
          observer.error(new Error(`HTTP Error: ${xhr.status}`));
        }
        
        // Remove from active XHRs
        const index = this.currentXHRs.indexOf(xhr);
        if (index !== -1) {
          this.currentXHRs.splice(index, 1);
        }
      };
      
      xhr.onerror = () => {
        observer.error(new Error('Network error'));
        
        // Remove from active XHRs
        const index = this.currentXHRs.indexOf(xhr);
        if (index !== -1) {
          this.currentXHRs.splice(index, 1);
        }
      };
      
      xhr.onabort = () => {
        observer.error(new Error('Upload cancelled'));
        
        // Remove from active XHRs
        const index = this.currentXHRs.indexOf(xhr);
        if (index !== -1) {
          this.currentXHRs.splice(index, 1);
        }
      };
      
      xhr.open('PUT', blockUrl, true);
      xhr.setRequestHeader('Content-Type', 'application/octet-stream');
      // Add optimized headers for better performance
      xhr.setRequestHeader('x-ms-blob-type', 'BlockBlob');
      xhr.setRequestHeader('Cache-Control', 'no-cache');
      xhr.send(content);
      
      // Handle cancellation
      const subscription = this.uploadCancelled$.subscribe(() => {
        if (xhr && xhr.readyState !== 4) {
          xhr.abort();
        }
      });
      this.activeSubscriptions.push(subscription);
    });
  }

  private commitBlocks(blobName: string, blockIds: string[], contentType: string): Observable<void> {
    return new Observable<void>(observer => {
      const commitUrl = `${this.baseUrl}/${blobName}${environment.azureStorage.sasToken}&comp=blocklist`;
      
      // Create XML for block list
      let blockListXml = '<?xml version="1.0" encoding="utf-8"?><BlockList>';
      blockIds.forEach(id => {
        blockListXml += `<Latest>${btoa(id)}</Latest>`;
      });
      blockListXml += '</BlockList>';
      
      const xhr = new XMLHttpRequest();
      this.currentXHRs.push(xhr);
      
      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          observer.next();
          observer.complete();
        } else {
          observer.error(new Error(`HTTP Error: ${xhr.status}`));
        }
        
        // Remove from active XHRs
        const index = this.currentXHRs.indexOf(xhr);
        if (index !== -1) {
          this.currentXHRs.splice(index, 1);
        }
      };
      
      xhr.onerror = () => {
        observer.error(new Error('Network error'));
        
        // Remove from active XHRs
        const index = this.currentXHRs.indexOf(xhr);
        if (index !== -1) {
          this.currentXHRs.splice(index, 1);
        }
      };
      
      xhr.onabort = () => {
        observer.error(new Error('Upload cancelled'));
        
        // Remove from active XHRs
        const index = this.currentXHRs.indexOf(xhr);
        if (index !== -1) {
          this.currentXHRs.splice(index, 1);
        }
      };
      
      xhr.open('PUT', commitUrl, true);
      xhr.setRequestHeader('Content-Type', 'application/xml');
      xhr.setRequestHeader('x-ms-blob-content-type', contentType);
      xhr.send(blockListXml);
      
      // Handle cancellation
      const subscription = this.uploadCancelled$.subscribe(() => {
        if (xhr && xhr.readyState !== 4) {
          xhr.abort();
        }
      });
      this.activeSubscriptions.push(subscription);
    });
  }

  private padBlockId(blockNumber: number): string {
    // Block IDs must be the same length, so pad with leading zeros
    // Using 6 digits allows for files with up to ~16TB (8MB * 10^6)
    return `block${blockNumber.toString().padStart(6, '0')}`;
  }

  private retryWithBackoff(
    fn: () => Observable<any>,
    maxRetries: number,
    initialDelayMs: number
  ): Observable<any> {
    return fn().pipe(
      catchError((error, caught) => {
        if (error.name === 'AbortError' || error.message === 'Upload cancelled') {
          return of(error);
        }
        
        if (maxRetries <= 0) {
          return of(error);
        }
        
        // Exponential backoff
        const delay = initialDelayMs;
        
        return new Observable(observer => {
          setTimeout(() => {
            this.retryWithBackoff(fn, maxRetries - 1, initialDelayMs * 2)
              .subscribe(observer);
          }, delay);
        });
      })
    );
  }

  private adaptChunkSize(chunkTimes: number[]): void {
    if (chunkTimes.length < 5) return;
    
    // Calculate average chunk upload time
    const avgTime = chunkTimes.reduce((sum, time) => sum + time, 0) / chunkTimes.length;
    
    // Adjust chunk size based on performance
    if (avgTime < 1000) { // Less than 1 second per chunk
      this.DEFAULT_CHUNK_SIZE = Math.min(16 * 1024 * 1024, this.DEFAULT_CHUNK_SIZE * 2);
    } else if (avgTime > 5000) { // More than 5 seconds per chunk
      this.DEFAULT_CHUNK_SIZE = Math.max(2 * 1024 * 1024, this.DEFAULT_CHUNK_SIZE / 2);
    }
  }

  private formatTimeRemaining(seconds: number): string {
    if (seconds === Infinity || isNaN(seconds)) {
      return 'calculating...';
    }
    
    if (seconds < 60) {
      return `${Math.ceil(seconds)}s`;
    } else if (seconds < 3600) {
      const minutes = Math.floor(seconds / 60);
      const remainingSeconds = Math.ceil(seconds % 60);
      return `${minutes}m ${remainingSeconds}s`;
    } else {
      const hours = Math.floor(seconds / 3600);
      const minutes = Math.floor((seconds % 3600) / 60);
      return `${hours}h ${minutes}m`;
    }
  }
}
