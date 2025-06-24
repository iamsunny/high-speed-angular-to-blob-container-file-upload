import { Component, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { AzureStorageService, UploadProgress } from '../../services/azure-storage.service';
import { Subject, takeUntil, interval } from 'rxjs';

@Component({
  selector: 'app-file-upload',
  templateUrl: './file-upload.component.html',
  styleUrls: ['./file-upload.component.scss'],
  standalone: true,
  imports: [CommonModule]
})
export class FileUploadComponent implements OnDestroy {
  selectedFile: File | null = null;
  uploadProgress: UploadProgress | null = null;
  uploadStartTime: number = 0;
  uploadEndTime: number = 0;
  uploadDuration: string = '';
  isDragOver = false;
  isUploading = false;
  isLargeFile = false;
  elapsedTime = '00:00:00';
  totalUploadTime = '';
  private destroy$ = new Subject<void>();
  private timerSubscription: any;
  // Threshold for large file indicator (100MB)
  private readonly LARGE_FILE_THRESHOLD = 100 * 1024 * 1024;

  constructor(private azureStorage: AzureStorageService) {}

  onFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    if (input.files && input.files.length > 0) {
      this.resetUploadState();
      this.handleFile(input.files[0]);
    }
  }

  onDragOver(event: DragEvent): void {
    event.preventDefault();
    event.stopPropagation();
    this.isDragOver = true;
  }

  onDragLeave(event: DragEvent): void {
    event.preventDefault();
    event.stopPropagation();
    this.isDragOver = false;
  }

  onDrop(event: DragEvent): void {
    event.preventDefault();
    event.stopPropagation();
    this.isDragOver = false;

    if (event.dataTransfer && event.dataTransfer.files.length > 0) {
      this.resetUploadState();
      this.handleFile(event.dataTransfer.files[0]);
    }
  }

  private handleFile(file: File): void {
    // Validate file size (max 5GB)
    const maxSizeInBytes = 5 * 1024 * 1024 * 1024; // 5 GB
    if (file.size > maxSizeInBytes) {
      this.uploadProgress = {
        percentage: 0,
        status: 'failed',
        error: `File is too large. Maximum size is ${this.formatFileSize(maxSizeInBytes)}.`
      };
      return;
    }
    
    this.selectedFile = file;
    this.isLargeFile = file.size > this.LARGE_FILE_THRESHOLD;
  }

  uploadFile(): void {
    if (this.selectedFile) {
      this.uploadStartTime = Date.now();
      this.uploadEndTime = 0;
      this.uploadDuration = '';
      
      this.isUploading = true;
      this.uploadProgress = { percentage: 0, status: 'uploading' };
      
      // Start timer
      this.startTimer();

      this.azureStorage.uploadFile(this.selectedFile)
        .pipe(takeUntil(this.destroy$))
        .subscribe({
          next: (progress) => {
            this.uploadProgress = progress;
            
            if (progress.status === 'completed') {
              this.isUploading = false;
              this.uploadEndTime = Date.now();
              const duration = this.uploadEndTime - this.uploadStartTime;
              this.uploadDuration = this.formatDuration(duration);
              this.stopTimer(true);
            } else if (progress.status === 'cancelled') {
              this.isUploading = false;
              this.stopTimer(false);
            }
          },
          error: (error) => {
            this.isUploading = false;
            this.stopTimer(false);
            this.uploadProgress = {
              percentage: 0,
              status: 'failed',
              error: 'Upload failed: ' + (error.message || 'Unknown error')
            };
          }
        });
    }
  }

  cancelUpload(): void {
    if (this.isUploading) {
      this.azureStorage.cancelUpload();
      // The upload progress will be updated via the subscription
    } else {
      this.resetUploadState();
      this.selectedFile = null;
      this.isLargeFile = false;
      this.totalUploadTime = '';
    }
  }

  private resetUploadState(): void {
    this.uploadProgress = null;
    this.isUploading = false;
    this.stopTimer(false);
    this.elapsedTime = '00:00:00';
  }

  formatFileSize(bytes: number): string {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }

  getSpeedEmoji(speedString: string): string {
    // Extract the numeric part from the speed string (e.g. "5.23 MB/s")
    const match = speedString.match(/^(\d+(\.\d+)?)/);
    if (!match) return '';
    
    const speed = parseFloat(match[1]);
    
    if (speed < 1) return '🐢'; // Slow
    if (speed < 3) return '🚶'; // Moderate
    if (speed < 8) return '🏃'; // Fast
    if (speed < 15) return '🚴'; // Very fast
    return '⚡'; // Super fast
  }

  private startTimer(): void {
    this.uploadStartTime = Date.now();
    this.elapsedTime = '00:00:00';
    
    if (this.timerSubscription) {
      this.timerSubscription.unsubscribe();
    }
    
    this.timerSubscription = interval(1000)
      .pipe(takeUntil(this.destroy$))
      .subscribe(() => {
        const elapsedSeconds = Math.floor((Date.now() - this.uploadStartTime) / 1000);
        this.elapsedTime = this.formatTime(elapsedSeconds);
      });
  }

  private stopTimer(completed: boolean): void {
    if (this.timerSubscription) {
      this.timerSubscription.unsubscribe();
      this.timerSubscription = null;
    }
    
    if (completed && this.uploadStartTime > 0) {
      this.uploadEndTime = Date.now();
      const totalSeconds = Math.floor((this.uploadEndTime - this.uploadStartTime) / 1000);
      this.totalUploadTime = this.formatTime(totalSeconds);
    }
  }

  private formatTime(totalSeconds: number): string {
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    
    return [
      hours.toString().padStart(2, '0'),
      minutes.toString().padStart(2, '0'),
      seconds.toString().padStart(2, '0')
    ].join(':');
  }

  formatDuration(ms: number): string {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    
    if (hours > 0) {
      return `${hours}h ${minutes % 60}m ${seconds % 60}s`;
    } else if (minutes > 0) {
      return `${minutes}m ${seconds % 60}s`;
    } else {
      return `${seconds}s`;
    }
  }

  getProgressBarClasses(): string {
    if (!this.uploadProgress) return '';
    
    if (this.uploadProgress.status === 'completed') {
      return 'progress-bar-success';
    } else if (this.uploadProgress.status === 'failed') {
      return 'progress-bar-danger';
    } else {
      return '';
    }
  }

  ngOnDestroy(): void {
    if (this.timerSubscription) {
      this.timerSubscription.unsubscribe();
    }
    this.destroy$.next();
    this.destroy$.complete();
  }
}
