// jshint esversion: 6

// express code

const express = require("express");
const app = express();

const http = require("http").Server(app);

app.use(express.static(__dirname));

app.get("/", function (req, res) {
  res.sendFile(__dirname + "/index.html");
});
process.on("uncaughtException", (err) => {
  console.error("There was an uncaught error", err);
  process.exit(1); //mandatory (as per the Node.js docs)
});
// end express code

// setup Socket.io Server and Proxy
const url = require("url");
const base64id = require("base64id");
const port = process.env.PORT || 3003;
const io = require("socket.io")(http);
// overload to use passed in ID as socket.id
io.engine.generateId = (req) => {
  const parsedUrl = new url.parse(req.url);
  const params = new URLSearchParams(parsedUrl.search);
  const prevId = params.get("id");
  // prevId is either a valid id or an empty string
  if (prevId) {
    return prevId;
  }
  return base64id.generateId();
};
//#region Code

//#region Admin tests: code to be extended soon
const admin = io.of("/admin");
admin.on("connect", (socket) => {
  console.warn("admin socket.id:", socket.id);

  socket.on("message", (data) => console.log(data));
});
//#endregion

// set up Server Proxy
const { getNow, printJson, logResults, ServerProxy } = require("./radar");
const S = new ServerProxy(io);

// other utilities
const clc = require("cli-color");
const success = clc.red.green;
const colorExposureAlert = clc.green;
const colorExposureWarning = clc.yellow.red;
const error = clc.red.bold;
const warn = clc.yellow;
const info = clc.cyan;
const notice = clc.blue;
const highlight = clc.magenta;
const bold = clc.bold;

const moment = require("moment");

const { version } = require("./package.json");

// helpers

function onConnection(query) {
  console.groupCollapsed(
    `EVENT: onConnection [${query.visitor || query.room || query.admin} / ${
      query.id
    }] ${query.closed ? "Closed" : "Open"}`
  );
  let result = S.handlePendings(query);
  query.result = result;
  console.log("Socket Room Pending State:", query.result);

  console.group("Open Rooms:");
  console.log(printJson(S.openRooms));
  console.groupEnd();

  console.group("Visitors:");
  console.log(printJson(S.visitors));
  console.groupEnd();

  // console.group('Sockets:');
  // console.log(printJson(S.sockets));
  // console.groupEnd();

  console.group("Available Rooms:");
  console.log(printJson(S.available));
  console.groupEnd();

  // console.group('Rooms:');
  // console.log(printJson(S.rooms));
  // console.groupEnd();

  console.groupEnd();
  S.exposeOpenRooms();
}

function newSection(text) {
  console.log(
    success(`
[${getNow()}] ${text}`)
  );
}
// end helpers

// Heavy lifting below
//=============================================================================//

// called when a connection changes
io.on("connection", (socket) => {
  const query = socket.handshake.query;
  newSection(`Handling a connection to ${socket.id}`);
  if (query.id) {
    if (query.room && !query.closed) {
      console.groupCollapsed(`[${getNow()}] Reopening ${query.room}`);
      socket.join(query.room);
      console.log("Open Rooms:", printJson(S.exposeOpenRooms()));
      console.groupEnd();
    }
    onConnection(query);
  } else {
    console.log(
      error(`Unknown socket ${socket.id} (probably from client refresh).`)
    );
    console.log(socket);

    socket.disconnect(true);
  }

  //...........................................................................//
  //#region Listeners

  //#region Open/Close Room
  // called by State Machine to bring a Room online
  // so that Visitors can enter
  // this can change the state of io...rooms
  // next step in the pipeline is to access pending Visitor exposure warnings
  const onOpenRoom = (data, ack) => {
    try {
      // const { room, id } = data;
      const { room, id } = socket.handshake.query;

      if (!room) {
        console.error(
          `${id} is not an LCT Room socket. No further processing possible.`
        );
        return;
      }

      // if Room is already open, return
      if (S.isOpen(id)) {
        console.log(
          `${room} is already open. No further processing necessary.`
        );
        if (ack) {
          ack({
            event: "onOpenRoom",
            room: data.room,
            state: "Reopened",
            result: true,
          });
        }
        return;
      }

      // console.log(message, socket.handshake.query);
      console.groupCollapsed(`[${getNow()}] EVENT: onOpenRoom ${data.room}`);

      console.log(`Open Rooms before ${data.room} opens...`);
      console.log(printJson(S.openRooms));
      socket.join(data.room);

      console.log(`...and after ${data.room} opens`);

      console.log(printJson(S.exposeOpenRooms()));
      console.log("Emitted exposeOpenRooms event");

      console.log("Visitors");
      console.log(printJson(S.visitors));

      // console.log('Available');
      // console.log(printJson(S.available));
      // console.log('Rooms');
      // console.log(printJson(S.openRooms));

      // check for pending warnings
      console.log("...", S.handlePendings(socket.handshake.query));
      // if this checks for connection, why not check Room connected property?
      const assertion = S.roomIdsIncludeSocket(data.room, id);

      console.assert(assertion, `${id} unable to join ${data.room}`);

      if (ack) {
        ack({
          event: "onOpenRoom",
          room: data.room,
          state: "Opened",
          result: assertion,
        });
      }
    } catch (error) {
      console.error("Oops, onOpenRoom() hit this:", error.message);
    } finally {
      console.groupEnd();
    }
  };

  const onCloseRoom = function (data, ack) {
    try {
      const { room, id, nsp } = data;
      console.group(`[${getNow()}] EVENT: onCloseRoom [${room}]`);

      console.log(`Rooms before ${room} closing...`);
      console.log(printJson(S.openRooms));

      console.group("Occupants");
      console.log("Occupants of Room before closing...");
      console.log(printJson(S.rooms[room]));

      Object.keys(S.rooms[room].sockets).forEach((value) => {
        S.getSocket(value).leave(room);
      });

      console.log("...and after Room closing:");
      console.log(printJson(S.rooms[room]));
      console.groupEnd();

      console.log(`...after ${room} closing`);
      console.log(printJson(S.openRooms));
      console.log("Sockets");
      console.log(printJson(S.sockets));
      console.log("Open Rooms");
      console.log(printJson(S.exposeOpenRooms()));
      console.log("Emitted exposeOpenRooms event");

      // if this checks for connection, why not check Room connected property?
      const assertion = !S.roomIdsIncludeSocket(room, id);

      console.assert(assertion, `${id} unable to leave ${room}`);

      if (ack) {
        ack({ event: "onCloseRoom", room: room, result: assertion });
      }
    } catch (error) {
      console.error("Oops, closeRoom() hit this:", error.message);
    } finally {
      console.groupEnd();
    }
  };
  //#endregion

  //#region Enter/Leave Room
  // Visitor sends this event
  const onEnterRoom = (data, ack) => {
    try {
      const { room, id, nsp, sentTime, visitor } = data;
      console.groupCollapsed(`[${getNow()}] EVENT: onEnterRoom ${room}`);

      // first, ensure the Room is open (note S.rooms returns an object
      // that will include the name of an Open Room after a Room opens its own
      // io room):
      if (!S.rooms[room]) {
        if (ack) {
          ack({
            error: "Room must be open before you can enter",
            on: "server.onEnterRoom",
          });
        }
      }

      // Enter the Room. As others enter, you will see a notification they, too, joined.
      socket.join(room);

      //S.roomIdsIncludeSocket essentially calls:
      //const result = io.nsps['/'].adapter.rooms
      // && io.nsps['/'].adapter.rooms[room].sockets[socket.id];
      const assertion = S.roomIdsIncludeSocket(room, socket.id);
      console.assert(assertion, "Could not enter Room", room);

      // handled by Room.checkIn()
      // sending to individual socketid (private message)
      // this emit assumes the room is open (and not merely connected)
      io.to(room).emit("checkIn", {
        visitor: visitor,
        sentTime: sentTime,
        room: room,
        message: "Entered",
        socketId: socket.id,
      });

      const occupants = S.getOccupancy(room);
      console.log(warn(`${room} has ${occupants} occupants now:`));
      console.log(printJson(S.rooms[room]));
      if (occupants) {
        if (ack) {
          ack({
            event: "onEnterRoom",
            room: room,
            occupants: occupants,
            result: assertion,
            emits: "checkIn",
          });
        }
      } else {
        if (ack) {
          ack({
            event: "onEnterRoom",
            room: room,
            result: `Could not enter Room ${room}`,
            emits: "nothing",
          });
        }
      }
    } catch (error) {
      console.error("Oops, onEnterRoom() hit this:", error);
    } finally {
      console.groupEnd();
    }
  };

  const onLeaveRoom = (data, ack) => {
    const { room, visitor, sentTime, message } = data;
    console.groupCollapsed(`[${getNow()}] EVENT: onLeaveRoom ${room}`);
    socket.leave(room);

    // handled by Room.checkOut()
    // sending to individual socketid (private message)
    io.to(room).emit("checkOut", {
      visitor: visitor,
      sentTime: sentTime,
      room: room,
      message: message,
    });

    S.updateOccupancy(room);

    const msg = `Using their own socket ${socket.id}, ${visitor.visitor} ${
      S.roomIdsIncludeSocket(room, socket.handshake.query.id)
        ? "did not make it out of"
        : "made it out of"
    } Room ${room} on ${getNow()}`;

    console.log(warn("leaveRoom():", msg));
    if (ack) {
      ack(msg);
    }
    console.groupEnd();
  };

  //#endregion

  //#region Warnings and Alerts
  /* Visitor sends this event containing all warnings for all exposed Rooms
  // Warning data:
  // {
  //    "sentTime": "2020-11-18T16:07:52.336Z",
  //    "visitor": {
  //       "$id": "oTFyI-JZyKBS5jNYAAAA",
  //       "visitor": "You",
  //       "id": "oTFyI-JZyKBS5jNYAAAA",
  //       "nsp": "enduringNet"
  //    },
  //    "warnings": {
  //       "fika": {
  //          "room": "fika",
  //          "dates": [
  //             "2020-11-17",
  //             "2020-11-17"
  //          ]
  //       }
  //    }
// }
{
   "sentTime": "2020-11-24T19:52:55.693Z",
   "visitor": {
      "$id": "-DfaxawFa31U2rn2AAAB",
      "visitor": "MichaelUK",
      "id": "-DfaxawFa31U2rn2AAAB",
      "nsp": "enduringNet"
   },
   "reason": "LCT warned me of possible exposure",
   "warningsMap": [
      [
         "DS301",
         [
            "2020-11-24"
         ]
      ]
   ]
}
*/

  // sent by Visitor
  // server handles the Visitor's exposureWarning with a notifyRoom event so Room can take over
  const onExposureWarning = (data, ack) => {
    try {
      const { visitor, warningsMap, reason } = data;
      console.assert(visitor, "visitor cannot be empty");
      console.groupCollapsed(
        `[${getNow()}] EVENT: onExposureWarning from [${visitor.visitor}/${
          visitor.id
        }]`
      );
      console.group("Open Rooms:");
      console.log(printJson(S.openRooms));
      console.groupEnd();

      console.group("Warning data:");
      console.log(printJson(data));
      console.groupEnd();

      let results = [];

      const warnings = new Map(warningsMap);

      console.group("Mapped Warning data:");
      console.log(printJson([...warnings]));
      console.groupEnd();

      // iterate collection notifying each Room separately
      // notifyRoom expects this data:
      // {room, reason, exposureDates, visitor}
      warnings.forEach((exposureDates, room) => {
        results.push(
          S.sendOrPend({
            event: "notifyRoom",
            room: room,
            reason: reason,
            exposureDates: exposureDates,
            visitor: visitor.id,
          })
        );
      });

      if (ack) {
        ack({
          handler: "onExposureWarning",
          result: results.flat(),
          emits: "notifyRoom",
        });
      }
    } catch (error) {
      console.error("onExposureWarning sees:", error);
    } finally {
      console.groupEnd();
    }
  };

  // Room sends this event
  // Server forwards content to Visitor(s) with exposureAlert event sent with alertVisitor handler
  function onAlertVisitor(data, ack) {
    // Visitor message includes the Room names to alert
    try {
      const { message, visitor, room } = data;
      console.groupCollapsed(
        `[${getNow()}] EVENT: onAlertVisitor [${visitor.visitor}/${visitor.id}]`
      );
      if (!message || !visitor) {
        if (ack) {
          ack(
            new error(
              `${
                message ? "Missing visitor identity" : "No message to process"
              }`
            )
          );
        }
        return;
      }

      // send or cache the alert
      console.log(`${room} alerting ${visitor.visitor}`);
      data.event = "exposureAlert";
      let result = S.sendOrPend(data);
      console.groupEnd();

      if (ack) {
        ack(result);
      }
    } catch (error) {
      console.error("ERROR: onAlertVisitor sees:", error);
    } finally {
      console.groupEnd();
    }
  }
  //#endregion

  //#endregion end listeners
  //...........................................................................//

  //+++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++//
  // Socket Events
  // Rooms send these events
  socket.on("openRoom", onOpenRoom); // sent from Room for each visitor
  socket.on("closeRoom", onCloseRoom);
  // (each Visitor warned each Room the date(s) Visitor occupied the Room)
  socket.on("alertVisitor", onAlertVisitor);

  // sent from Visitor
  // Visitor sends this message:
  // {visitor:{name, id, nsp}, room:{room, id, nsp}, message:{}, sentTime: dateTime}
  // disambiguate enterRoom event from the event handler in the Room, checkIn
  socket.on("enterRoom", onEnterRoom);
  // disambiguate leaveRoom event from the event handler in the Room, checkOut
  socket.on("leaveRoom", onLeaveRoom);
  socket.on("exposureWarning", onExposureWarning);

  // end Socket Events
  //+++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++//

  // Admin events (for Room managers use)

  socket.on("exposeAllSockets", (data, ack) => {
    if (ack) {
      ack(S.sockets);
    }
  });
  socket.on("exposeOpenRooms", (data, ack) => {
    if (ack) {
      ack(S.exposeOpenRooms());
    }
  });
  socket.on("exposePendingWarnings", (data, ack) => {
    if (ack) {
      ack(S.pendingWarnings);
    }
  });
  socket.on("exposeAvailableRooms", (data, ack) => {
    if (ack) {
      ack(S.available);
    }
  });
  socket.on("exposeVisitorsRooms", (data, ack) => {
    if (ack) {
      ack(S.visitors);
    }
  });

  socket.on("pingServer", function (data, ack) {
    if (ack) ack(`Server is at your disposal, ${data}`);
  });

  socket.on("disconnect", (reason) => {
    console.warn(
      `[${getNow()}] EVENT: disconnect: ${socket.id}/${
        socket.handshake.query.visitor || socket.handshake.query.room
      } disconnected. Reason:
       ${reason}`
    );
    console.log(`onDisconnect: Sockets at ${getNow()}:`);
    console.log(S.rawSockets);
  });

  socket.on("disconnecting", (reason) => {
    console.log("Disconnecting");
    console.log(`Sockets at ${getNow()}:`);
    console.log(S.rawSockets);
  });
});

io.on("reconnect", (socket) => {
  // immediately reconnection
  if (socket.handshake.query.id) {
    console.log("...", S.handlePendings(socket.handshake.query));

    console.table(S.sockets);
  }
});

//#endregion

http.listen(port, function () {
  let hostname = "http://localhost";
  console.log(info(`Server.js Build: ${version}`));
  console.log(info(moment().format("llll")));
  console.log(info(`socket.io server listening on: ${hostname}:${port}`));
  console.log(" ");
});
