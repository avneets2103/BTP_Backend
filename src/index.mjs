import dotenv from 'dotenv';
import { connectDB } from './DB/index.mjs';
import { app } from './app.mjs';
import serverless from 'serverless-http';

dotenv.config({
    path: "./env"
});

export const handler = async (event, context) => {
    try {
        // Ensure database is connected before handling requests
        await connectDB();

        // Use `serverless-http` to handle HTTP requests in Lambda
        const serverlessApp = serverless(app);
        return await serverlessApp(event, context);
    } catch (error) {
        console.error("Error handling the request:", error);
        return {
            statusCode: 500,
            body: JSON.stringify({ message: "Internal Server Error" }),
        };
    }
};