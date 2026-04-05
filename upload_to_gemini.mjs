#!/usr/bin/env node
// Run this script ONCE to upload the PDF to Google File API.
// Usage: node upload_to_gemini.mjs YOUR_API_KEY
// It will print the file URI to paste into app.js.

const API_KEY = process.argv[2];
if (!API_KEY) {
    console.error("Usage: node upload_to_gemini.mjs YOUR_API_KEY");
    process.exit(1);
}

import { readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pdfPath = path.join(__dirname, 'KEAM_PYQ_All.pdf');

console.log("Reading PDF file...");
const pdfBuffer = readFileSync(pdfPath);
const pdfBytes = pdfBuffer.length;
console.log(`PDF size: ${(pdfBytes / 1024 / 1024).toFixed(1)} MB`);

// Step 1: Start resumable upload
console.log("Starting resumable upload to Google File API...");
const startResponse = await fetch(
    `https://generativelanguage.googleapis.com/upload/v1beta/files?key=${API_KEY}`,
    {
        method: "POST",
        headers: {
            "X-Goog-Upload-Protocol": "resumable",
            "X-Goog-Upload-Command": "start",
            "X-Goog-Upload-Header-Content-Length": pdfBytes,
            "X-Goog-Upload-Header-Content-Type": "application/pdf",
            "Content-Type": "application/json",
        },
        body: JSON.stringify({ file: { display_name: "KEAM_PYQ_All" } }),
    }
);

if (!startResponse.ok) {
    const errText = await startResponse.text();
    console.error("Failed to start upload:", errText);
    process.exit(1);
}

const uploadUrl = startResponse.headers.get("x-goog-upload-url");
console.log("Got upload URL, uploading file data...");

// Step 2: Upload the actual file bytes
const uploadResponse = await fetch(uploadUrl, {
    method: "POST",
    headers: {
        "X-Goog-Upload-Offset": "0",
        "X-Goog-Upload-Command": "upload, finalize",
        "Content-Length": pdfBytes,
    },
    body: pdfBuffer,
});

if (!uploadResponse.ok) {
    const errText = await uploadResponse.text();
    console.error("Failed to upload file:", errText);
    process.exit(1);
}

const fileData = await uploadResponse.json();
const fileUri = fileData.file?.uri;
const fileName = fileData.file?.name;
const expiry = fileData.file?.expirationTime;

console.log("\n✅ Upload successful!");
console.log(`File URI: ${fileUri}`);
console.log(`File Name: ${fileName}`);
console.log(`Expires: ${expiry}`);
console.log("\n⚠️  IMPORTANT: Copy the File URI above and paste it into app.js as GEMINI_FILE_URI.");
