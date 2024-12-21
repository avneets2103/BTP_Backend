import { S3Client, GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { TextractClient, StartDocumentTextDetectionCommand, GetDocumentTextDetectionCommand } from "@aws-sdk/client-textract"; // Importing Textract SDK

const s3Client = new S3Client({
  region: process.env.S3_CLIENT_REGION,
  credentials: {
    accessKeyId: process.env.S3_ACCESS_KEY_ID,
    secretAccessKey: process.env.S3_SECRET_ACCESS_KEY,
  },
});

// Initialize Textract client
const textractClient = new TextractClient({
  region: process.env.S3_CLIENT_REGION,
  credentials: {
    accessKeyId: process.env.S3_ACCESS_KEY_ID,
    secretAccessKey: process.env.S3_SECRET_ACCESS_KEY,
  },
});

const getObjectURL = async (key) => {
  const command = new GetObjectCommand({
    Bucket: process.env.S3_BUCKET_NAME,
    Key: key, // File key (path to the file in the bucket)
  });
  try {
    const url = await getSignedUrl(s3Client, command);
    return url;
  } catch (err) {
    console.error("Error generating signed URL:", err);
    throw err;
  }
};

const putObjectURL = async (fileName, fileType, expiryTime) => {
  const params = {
    Bucket: process.env.S3_BUCKET_NAME,
    Key: fileName, // File name provided by user
    ContentType: fileType, // Content-Type (e.g., 'image/jpeg', 'application/pdf')
    ACL: "private",
  };

  try {
    const command = new PutObjectCommand(params);
    const uploadUrl = await getSignedUrl(s3Client, command, {
      expiresIn: expiryTime,
    });

    return uploadUrl;
  } catch (err) {
    console.error("Error generating presigned URL:", err);
    return null;
  }
};

const extractTextFromPDF = async (documentKey) => {
  try {
    // Start document text detection
    const startCommand = new StartDocumentTextDetectionCommand({
      DocumentLocation: {
        S3Object: {
          Bucket: process.env.S3_BUCKET_NAME,
          Name: documentKey,
        },
      },
    });

    const startResponse = await textractClient.send(startCommand);
    const jobId = startResponse.JobId;

    // Poll for completion of the text detection job
    let isJobComplete = false;
    let pdfText = "";
    while (!isJobComplete) {
      // Delay to avoid throttling
      await new Promise(resolve => setTimeout(resolve, 5000));

      const getCommand = new GetDocumentTextDetectionCommand({ JobId: jobId });
      const getResponse = await textractClient.send(getCommand);

      // Check if job status is complete
      const status = getResponse.JobStatus;
      if (status === "SUCCEEDED") {
        isJobComplete = true;
        // Combine the detected text
        pdfText = getResponse.Blocks.filter(block => block.BlockType === "LINE")
                                    .map(block => block.Text)
                                    .join("\n");
      } else if (status === "FAILED") {
        throw new Error("Textract job failed");
      }
    }

    return pdfText;
  } catch (error) {
    console.error("Error extracting text from PDF:", error);
    throw error;
  }
};

export { 
    getObjectURL,
    putObjectURL,
    extractTextFromPDF // Export the new function
};
