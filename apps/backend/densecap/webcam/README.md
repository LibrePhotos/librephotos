# Webcam demo

If you have a powerful GPU, then the DenseCap model is fast enough to run in real-time. We provide two different ways to run a real-time
demo that runs a DenseCap model on frames from a webcam:

- **Single machine demo**: If you have a single machine with both a webcam and a powerful GPU, then this demo will allow you to
achieve framerates of up to 10 FPS.
- **Client / server demo**: If you have one machine with a powerful GPU and another machine with a webcam, this demo will allow
you to stream webcam frames from the client, run the model on the server, and ship the predictions back to the client for viewing.
Even with a powerful GPU on the server, the network overhead limits the framerate to around 3 FPS.
