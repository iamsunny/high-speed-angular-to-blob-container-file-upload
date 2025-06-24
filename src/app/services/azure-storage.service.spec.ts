import { TestBed } from '@angular/core/testing';

import { AzureStorageService } from './azure-storage.service';

describe('AzureStorageService', () => {
  let service: AzureStorageService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(AzureStorageService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });
});
