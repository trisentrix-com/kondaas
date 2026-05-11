import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import fs from 'fs';

/**
 * Cloudflare R2 Uploader
 * This tool takes the PDF from your AWS disk and moves it to the Cloudflare "Cabinet"
 */
export const uploadToR2 = async (filePath, fileName) => {
  // 1. Setup the connection to Cloudflare
  const s3Client = new S3Client({
    region: "auto", // Cloudflare R2 uses "auto"
    endpoint: "https://4e33423d54b6cbf1eed86d23ee1ab787.r2.cloudflarestorage.com",
    credentials: {
      accessKeyId: "3558be2f7b6d8ee6f37c41fc22bf2410", 
      secretAccessKey: "cfe5acdb09f6e06f4a61a47547220cad5f9ab7d05e1dcbc5e871da3f4da665c4",
    },
  });

  // 2. Read the file from your AWS disk
  const fileContent = fs.readFileSync(filePath);

  // 3. Prepare the "Delivery Instructions"
  const command = new PutObjectCommand({
    Bucket: "kondaas-invoices",
    Key: fileName, // The name the file will have in the cloud
    Body: fileContent,
    ContentType: "application/pdf",
  });

  try {
    // 4. Send the file to Cloudflare
    await s3Client.send(command);
    
    // 5. Create the Public Link (This is what the customer sees)
    // Note: This URL structure depends on how your friend sets up the R2 Public Access
    const publicUrl = `https://4e33423d54b6cbf1eed86d23ee1ab787.r2.cloudflarestorage.com/kondaas-invoices/${fileName}`;
    
    return publicUrl;
  } catch (error) {
    console.error("❌ R2 Upload Failed:", error);
    throw error;
  }
};