const moment = require("moment");
const { SOURCE, ROOM_TYPE } = require("./types");

const clc = require("cli-color");
const success = clc.red.green;
const error = clc.red.bold;
const warn = clc.yellow;
const info = clc.cyan;
const highlight = clc.magenta;
// globals
let namespace = "/";
let pendingWarnings = new Map();

const getNow = () => {
  return moment().format("HH:mm:ss");
};

function printJson(json) {
  return JSON.stringify(json, null, 3);
}

const logResults = (function () {
  let logResults = [];
  let title = "Log Results";
  let collapsed = true;

  function entry(message) {
    {
      this.time = moment().format("HH:MM:SS");
      this.message = message.text;
      this.level = message.level || 0;
      this.type = message.type || "output";
    }
  }

  return {
    hasData: function () {
      return logResults.length;
    },

    entitle: function (caption, collapsed = true) {
      if (!this.hasData()) title = caption;
      this.collapsed = collapsed;
    },

    //{type:'', level:'', date:'', message:''}
    add: function (e) {
      logResults.push(new entry(e));
    },

    clear: function () {
      logResults = [];
    },

    show: function (clear = true) {
      if (this.collapsed) {
        console.groupCollapsed(title);
      } else {
        console.group(title);
      }
      console.table(logResults);
      console.groupEnd();
      if (clear) {
        logResults = [];
      }
    },
  };
})();

class ServerProxy {
  constructor(io, pendingWarnings) {
    this.io = io;
    this.pendingWarnings = pendingWarnings;
  }

  get sockets() {
    return Object.entries(this.io.nsps[namespace].adapter.nsp.sockets).reduce(
      (a, c) => {
        let query = c[1].handshake.query;
        let b = {
          id: c[0],
          room: query.room,
          visitor: query.visitor,
          namespace: query.nsp,
          connected: c[1].connected,
          occupiedRooms: c[1].rooms,
        };
        a.push(b);
        return a;
      },
      []
    );
  }

  get rawSockets() {
    let x = [...Object.entries(this.io.nsps[namespace].adapter.nsp.sockets)];
    return x;
  }

  // online sockets that represent Rooms
  get available() {
    return this.sockets.filter((v) => v.room);
  }

  // includes sockets with generated IDs and given IDs
  // note: the latter implies the former
  // so a Room can be absent in this list even if its room
  // remains online
  // also, Visitors also have rooms with generated IDs
  // but they will appear visitors (below), and not in rooms
  get rooms() {
    return this.io.nsps[namespace].adapter.rooms;
  }

  // online sockets that represent Visitors
  get visitors() {
    return this.sockets.filter((v) => v.visitor);
  }

  // online Rooms (a Room)
  get openRooms() {
    let a = this.available;
    let o = this.rooms;
    return a.filter((v) => o[v.room]);
  }

  getSocket(id) {
    return this.io.nsps[namespace].adapter.nsp.sockets[id];
  }

  isOpen(id) {
    return this.openRooms.filter((v) => v.id == id).length;
  }

  getOccupancy(room) {
    if (!room) {
      throw "No room name specified";
    }
    return this.rooms[room].length;
  }

  // called by server.onExposureWarning and server.onAlertVisitor
  sendOrPend(data) {
    const { event, reason, visitor, room, exposureDates } = data;
    if (event == "exposureAlert") {
      //#region this.visitors data structure
      // Ensure Visitor is online to see alert, otherwise cache and send when they login again
      // this.visitors has this structure:
      // [
      //   {
      //     id: '-DfaxawFa31U2rn2AAAB',
      //     visitor: 'MichaelUK',
      //     uniqueName: '-DfaxawFa31U2rn2AAAB',
      //     namespace: 'enduringNet',
      //     connected: true,
      //     rooms: {
      //       '-DfaxawFa31U2rn2AAAB': '-DfaxawFa31U2rn2AAAB',
      //     },
      //   },
      //   {
      //     id: 'fhcoU6xEF-0wFmCVAAAA',
      //     visitor: 'MichaelUsa',
      //     uniqueName: 'fhcoU6xEF-0wFmCVAAAA',
      //     namespace: 'enduringNet',
      //     connected: true,
      //     rooms: {
      //       'fhcoU6xEF-0wFmCVAAAA': 'fhcoU6xEF-0wFmCVAAAA',
      //     },
      //   },
      // ];
      // so filter on the strongest predicate: ID
      // ***** NOTE: this.visitors can be empty only if all Visitors are disconnected
      // ***** So ensure a Visitor can't press the Warn Rooms button unless their socket is connected
      //#endregion
      if (this.visitors.filter((v) => v.id === visitor.id).length) {
        // sending to visitor socket in visitor's room (except sender)
        this.privateMessage(event, data);

        return "ALERTED";
      } else {
        // cache the Visitor warning
        pendingWarnings.set(visitor.id, data);
        console.warn(`${visitor.visitor} is offline. Caching event.`);
        console.group("Pending Warnings");
        console.log(printJson([...pendingWarnings]));
        console.groupEnd();

        return "PENDING";
      }
    }
    if (event == "notifyRoom") {
      // notifyRoom expects this data:
      // {room, reason, exposureDates, visitor}

      if (this.openRooms.filter((v) => v.room == room).length) {
        this.privateMessage(event, {
          room: room,
          reason: reason,
          exposureDates: exposureDates,
          visitor: visitor,
        });

        return "WARNED";
      } else {
        pendingWarnings.set(room, {
          room: room,
          reason: reason,
          visitor: visitor,
          exposureDates: exposureDates,
        });
        console.warn(`${room} is closed. Caching event.`);
        console.group("Pending Warnings");
        console.log(printJson([...pendingWarnings]));
        console.groupEnd();

        return "PENDING";
      }
    }
  }

  handlePendings(query) {
    console.log("Checking for pending warnings...");

    console.log("Pending Warnings:", printJson([...pendingWarnings]));

    // handle Room
    if (query.room) {
      // record Room state
      query.closed = this.isOpen(query.id);

      if (!pendingWarnings.has(query.room)) {
        let msg = `...Nothing pending for ${query.room} (which is ${
          this.isOpen(query.id) ? "open" : "closed"
        }).`;
        console.log(msg);
        return msg;
      }

      pendingWarnings.forEach((value, key) => {
        // value must contain destination of message
        this.privateMessage("notifyRoom", value);
        pendingWarnings.delete(key);
        console.groupCollapsed(`Pending Warnings for ${query.room}:`);

        console.log(warn(JSON.stringify(value, null, 3)));
        console.groupEnd();
      });
    }
    // handle Visitor or Admin
    else if (query.visitor || query.admin) {
      if (!pendingWarnings.size || !pendingWarnings.has(query.id)) {
        let msg = `...Nothing pending for Visitor ${query.visitor}`;
        console.log(msg);
        return msg;
      }

      pendingWarnings.forEach((value, key) => {
        // const message = {
        //   visitor: key,
        //   exposureDates: value.message,
        //   room: '',
        // };
        this.privateMessage("exposureAlert", value);
        pendingWarnings.delete(key);
      });
    }
  }

  notifyRoom(data) {
    const { room } = data;
    try {
      console.group(`[${getNow()}] EVENT: notifyRoom from ${room}`);
      this.privateMessage(room, "notifyRoom", data);
      return `${room} WARNED`;
    } catch (error) {
      console.error(error);
      return error;
    } finally {
      console.groupEnd();
    }
  }

  log() {
    let query = this.socket.handshake.query;
    if (query.room) {
      this.checkPendingRoomWarnings(query);
    }

    if (query.admin || query.visitor || query.room) {
      console.log(" ");
      console.log(
        highlight(
          moment().format("HH:mm:ss"),
          "In connection handler: Opening connection to a Room for:",
          query.admin || query.visitor || query.room,
          "using socketId:",
          query.id
        )
      );
    }

    this.openMyRoom();
  }

  // Event Heloers
  privateMessage(event, message) {
    console.info(`Emitting ${event} to ${message.room} with:`);
    console.log(printJson(message));

    // note: cannot attach callback to namespace broadcast event
    this.io.to(message.room).emit(event, message);
  }

  roomIdsIncludeSocket(roomName, id) {
    try {
      const result = this.rooms[roomName] && this.rooms[roomName].sockets[id];
      return result;
    } catch (error) {
      console.error(error);
      console.log("Returning false");
      return false;
    }
  }

  roomIsOnline(id) {
    return this.io.nsps[namespace].adapter.nsp.sockets[id];
  }
  socketIsOnline(id) {
    return this.io.nsps[namespace].sockets[id];
  }

  exposeOpenRooms() {
    const openRooms = this.openRooms;
    this.io.of(namespace).emit("openRoomsExposed", openRooms);
    return openRooms;
  }
  exposeAvailableRooms() {
    this.io.of(namespace).emit("availableRoomsExposed", this.available);
  }

  updateOccupancy(room) {
    if (room && this.rooms[room]) {
      let occupancy = this.rooms.length || 0;
      // sending to all clients in namespace 'myNamespace', including sender
      this.io.of(namespace).emit("updatedOccupancy", {
        room: room,
        occupancy: occupancy,
      });
      return occupancy;
    }
    return 0;
  }
}

module.exports = {
  getNow,
  logResults,
  printJson,
  ServerProxy,
};
