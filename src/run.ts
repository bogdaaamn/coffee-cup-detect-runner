import {
  LinuxImpulseRunner,
  Ffmpeg,
  ICamera,
  ImageClassifier,
} from "edge-impulse-linux";

import { createClient } from "@supabase/supabase-js";
import { Server } from "socket.io";
import { fileURLToPath } from "url";

import express from "express";
import http from "http";
import path from "path";
import sharp from "sharp";

// Get __dirname equivalent
// See issue https://nodejs.org/docs/latest-v15.x/api/esm.html#esm_no_filename_or_dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Get env supabase configuration
const { SUPABASE_URL, SUPABASE_ANON_KEY } = process.env;

type ModelType = {
  project: { name: string; owner: string };
  modelParameters: {
    image_channel_count: number;
    image_input_width: number;
    image_input_height: number;
  };
};

type BoundingBoxType = {
  width: number;
  height: number;
  x: number;
  y: number;
  value: number;
  label: string;
};

// Check if the model file argument is provided
if (!process.argv[2]) {
  console.log("Missing one argument (model file)");
  process.exit(1); // Exit if the model file argument is missing
}

// Check if the Supabase configuration is provided
if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  console.log("Missing Supabase configuration");
  process.exit(1); // Exit if the Supabase configuration is missing
}

console.log("Init supabase...");

// Initialize the Supabase client
const supabaseClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

console.log("Init runner...");

// Initialize the LinuxImpulseRunner with the provided model file
const runner = new LinuxImpulseRunner(process.argv[2]);
const model = await runner.init(); // Load the model

console.log(
  "Starting the image classifier for",
  model.project.owner + "/" + model.project.name,
  "(v" + model.project.deploy_version + ")"
);

console.log(
  "Parameters",
  "image size",
  model.modelParameters.image_input_width +
    "x" +
    model.modelParameters.image_input_height +
    " px (" +
    model.modelParameters.image_channel_count +
    " channels)",
  "classes",
  model.modelParameters.labels
);

console.log("Init camera...");

// Initialize the camera using the Ffmpeg module
const camera = new Ffmpeg(process.env.VERBOSE === "1" /* verbose */);
await camera.init();

console.log("Init device...");

// List available camera devices
const devices = await camera.listDevices();

// Check if any webcams are found
if (devices.length === 0) {
  throw new Error("Cannot find any webcams!"); // Throw an error if no webcams are found
}

const device = devices[0]; // Select the first available device

console.log("Found device!");
console.log("Starting camera...");

// Start the camera with the selected device and set the capture interval to 100ms
await camera.start({
  device: device,
  intervalMs: 100,
});

console.log("Connected to camera!");
console.log("Starting classifier...");

// Initialize and start the image classifier
const imageClassifier = new ImageClassifier(runner, camera);
await imageClassifier.start();

console.log("Started classifier!");

// Start the socket server to serve the web interface and provide real-time images
startSocket(model, camera, imageClassifier);

// Function to start the socket server
function startSocket(
  model: ModelType,
  camera: ICamera,
  imageClassifier: ImageClassifier
) {
  console.log("Starting server...");

  const app = express();

  // Serve the static resource from edge impulse
  // This makes it that we can use the camera UI out of the box
  // http://192.168.1.137:4911/
  app.use(express.static(path.join(__dirname, "..", "public")));

  const server = new http.Server(app);
  const io = new Server(server);

  server.listen(4911, process.env.HOST || "0.0.0.0", async () => {
    console.log("Server listening on http://192.168.1.137:4911");
  });

  // Handle camera snapshot event
  camera.on("snapshot", async (data) => {
    // Resize the image and prepare it for sending
    const image = sharp(data).resize({
      height: model.modelParameters.image_input_height,
      width: model.modelParameters.image_input_width,
    });

    // Emit the resized image to the clients
    io.emit("image", {
      img:
        "data:image/jpeg;base64," +
        (await image.jpeg().toBuffer()).toString("base64"),
    });
  });

  // Initialize the flags for coffee-cup detection
  // The firstClassificationTime is used to record the time when the coffee-cup is detected
  // The isLastFrameClassified is used to check if the coffee-cup is detected in the previous frame
  // The isCupRecorded is used to check if the coffee-cup is already recorded in the database
  let firstClassificationTime = 0;
  let isLastFrameClassified = false;
  let isCupRecorded = false;

  // Handle classification result event
  imageClassifier.on("result", async (result, timeMs, imgAsJpg) => {
    const classificationResult = result.result;

    // Filter bounding boxes with a minimum score of 0.75
    // And ensure there is only one box per label
    if (classificationResult.bounding_boxes) {
      const boundingBoxes: BoundingBoxType[] =
        classificationResult.bounding_boxes
          .filter((b: BoundingBoxType) => b.value >= 0.75)
          .reduce((acc: BoundingBoxType[], b) => {
            if (!acc.find((x) => x.label === b.label)) {
              acc.push(b);
            }
            return acc;
          }, []);

      // Check if the bounding box for coffee-cup is detected
      if (boundingBoxes.find((b) => b.label === "coffee-cup")) {
        // Check if the coffee-cup is detected for the first time
        if (!isLastFrameClassified) {
          // Record the first classification time
          firstClassificationTime = Date.now();
          isLastFrameClassified = true;
        } else {
          // Check if the coffee-cup is detected for more than 3 seconds
          if (Date.now() - firstClassificationTime > 3000) {
            // Check if the coffee-cup is not already recorded
            if (!isCupRecorded) {
              console.log("Coffee cup detected for more than 3 seconds!");
              console.log("Recording to the database...");

              // Record the coffee-cup detection to the database
              // for the first time
              const { error } = await supabaseClient
                .from("detections")
                .insert({ message: "Coffee cup detected" });

              // Check if there is an error recording to the database
              if (error) {
                // Don't do anything if error.. try again
                console.error("Error recording to the database", error);
              } else {
                // Set the coffee-cup recorded flag to true so
                // that it is not recorded again
                isCupRecorded = true;
                console.log("Recorded to the database");
              }
            }
          }
        }
      } else {
        // Reset the flags if the coffee-cup is not detected
        // The next time it is detected, it will be recorded again
        firstClassificationTime = 0;
        isLastFrameClassified = false;
        isCupRecorded = false;
      }

      classificationResult.bounding_boxes = boundingBoxes;
    }

    // Emit the classification result and time taken to the client
    io.emit("classification", {
      result: result.result,
      timeMs: timeMs,
    });
  });

  // Handle new client connections say hello
  io.on("connection", (socket) => {
    socket.emit("hello", {
      projectName: model.project.owner + " / " + model.project.name,
    });
  });
}
