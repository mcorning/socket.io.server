# socket.io.server

The is the server half of Local Contact Tracing (<https://soterialct.z22.web.core.windows.net/>).

This is a socket.io server for managing messages passed between Visitors and Rooms.

## Access points

We can use three different access points for the socket.io Server:

* localhost URL
* ngrok (dynamic) URL
* Azure URL

We maintain each URL in the config.json file on the client side. At this writing, that file contains these values:

```json
    "socketUrl": "http://soterialct.westus2.cloudapp.azure.com:3000/",
    "ioServerAzureUrl": "http://soterialct.westus2.cloudapp.azure.com:3000/",
    "ioServerUrl": "http://localhost:3000/",
    "ngrokUrl": "http://71bd0336bacc.ngrok.io",

```

The VM is used for production, so the only way to run the Server is with

```bash
node .

```

that will execute the `app.js` file.
