# Edge Impulse to Supabase on Linux

This is an application that runs an object detection model using Edge Impulse on Linux. It stores every moment when you hold a coffee cup longer than 3 seconds in a Supabase database.

It is heavily based on the Edge Impulse [example-linux-with-twilio](https://github.com/edgeimpulse/example-linux-with-twilio) example application.

## Edge Impulse

To run this application you need a [development board](https://docs.edgeimpulse.com/docs/raspberry-pi-4) that supports Edge Impulse. You need to train an [object detection model](https://docs.edgeimpulse.com/docs/tutorials/end-to-end-tutorials/object-detection/object-detection) that detects coffee cups. You need camera available on the board to run this model.

Once you have a trained model, install the [edge-impulse-linux](https://docs.edgeimpulse.com/docs/edge-ai-hardware/cpu/raspberry-pi-4#id-2.-installing-dependencies) libraries to get your model running.

## Supabase

To send data to the database, you need a Supabase project.

You can head over to [database.new](https://database.new/) to create a new Supabase project. When your project is up and running, navigate to the project's [SQL Editor](https://supabase.com/dashboard/project/_/sql/new) and paste in the following snippet:

```
create table detections (
  id uuid NOT NULL DEFAULT uuid_generate_v4(),
  created_at timestamp with time zone not null default current_timestamp,
  action text
);
```

This will create a `detections` table in which you can insert rows every time, for example, a coffee cup is detected.

Alternatively, you can manually navigate to your project's [Table Editor](https://supabase.com/dashboard/project/_/editor) and configure the table manually.

## Development

1. Download the trained model to your device, [more details here](https://docs.edgeimpulse.com/docs/edge-ai-hardware/cpu/raspberry-pi-4#deploying-back-to-device)

```
$ edge-impulse-linux-runner --download model.eim
```

2. Clone this repository

```
$ git clone https://github.com/bogdaaamn/coffee-cup-detect-runner
```

3. Install the dependencies, make sure you have [Node and npm installed](https://docs.npmjs.com/downloading-and-installing-node-js-and-npm) on your device

```
$ npm install
```

4. Create an `.env` file (see `.env.example`) and copy the Supabase credentials, [more details here](https://supabase.com/docs/guides/getting-started/quickstarts/nextjs)

```
NEXT_PUBLIC_SUPABASE_URL=<SUPABASE_URL>
NEXT_PUBLIC_SUPABASE_ANON_KEY=<SUPABASE_ANON_KEY>
```

5. Start the application

```
$ npm run build
$ npm start
```

6. Additionally, you can open a web browser at [http://localhost:4911](http://localhost:4911) to see the live webcam feed. You can keep an eye on the logs to see data being sent to the database.

## Resources

- https://docs.edgeimpulse.com/docs/raspberry-pi-4
- https://docs.edgeimpulse.com/docs/tutorials/end-to-end-tutorials/object-detection/object-detection
- https://supabase.com/docs/guides/database/overview
- https://supabase.com/docs/guides/realtime
- https://supabase.com/docs/guides/getting-started/quickstarts/nextjs
