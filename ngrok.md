# ngrok

## Start Socket.io server

```
nodemon .
```

note port 3000

## Start ngrok

```
./ngrok http 3000

```

## Use Web Interface

```
http://127.0.0.1:4040

```

## Use the Service

Do not go to <https://localhost:3000> directly. Open the LCT app, instead:

<http://localhost:8080/>

or

<https://soterialct.z22.web.core.windows.net/visitor>

## Config

This file holds your authentication token:

[C:\Users\mcorn\.ngrok2\ngrok.yml](file://C:\Users\mcorn\.ngrok2\ngrok.yml)

To use `ngrok start`, you can add entries to this ngrok config file.