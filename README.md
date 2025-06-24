# Azure Blob Storage Upload

A modern Angular application for uploading files directly to Azure Blob Storage.

![](/assets/screenshot.png)

## Features

- Drag and drop file upload interface
- Progress tracking with visual feedback
- Direct upload to Azure Blob Storage
- Responsive design
- Error handling and success notifications

## Prerequisites

- Node.js (v14 or higher)
- Angular CLI (v19)
- An Azure Storage account with a container and SAS token

## Installation

1. Clone the repository:
   ```
   git clone <repository-url>
   cd azure-blob-upload
   ```

2. Install dependencies:
   ```
   npm install
   ```

3. Configure Azure Storage:
   
   Update the `src/environments/environment.ts` file with your Azure Storage account details:
   ```typescript
   export const environment = {
     production: false,
     azureStorage: {
       accountName: 'your-storage-account-name',
       containerName: 'your-container-name',
       sasToken: 'your-sas-token'
     }
   };
   ```
4. [Set appropriate CORS rules on your Azure Storage account](https://learn.microsoft.com/en-us/rest/api/storageservices/cross-origin-resource-sharing--cors--support-for-the-azure-storage-services).


## Running the Application

Start the development server:

```
ng serve
```

Navigate to `http://localhost:4200/` in your browser to use the application.

## How to Use

1. **Upload a File**:
   - Drag and drop a file onto the upload area, or click to browse for a file
   - The selected file details will be displayed
   - Click the "Upload to Azure" button to start the upload

2. **Monitor Progress**:
   - A progress bar will show the upload status
   - Upon completion, a success message will be displayed
   - If an error occurs, an error message will be shown with details

## Building for Production

To build the application for production:

```
ng build --configuration=production
```

The build artifacts will be stored in the `dist/azure-blob-upload` directory.

## Security Considerations

- The SAS token in the environment file should be kept secure and not committed to public repositories
- This is a POC project, to test out the upload. For production use, consider implementing server-side generation of SAS tokens
- Set appropriate CORS rules on your Azure Storage account

## License

This project is licensed under the MIT License - see the LICENSE file for details.
