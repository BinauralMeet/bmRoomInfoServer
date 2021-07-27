// Copyright 2018-2021 the Deno authors. All rights reserved. MIT license.
import { serve } from "https://deno.land/std/http/server.ts"
//  import { serveTLS } from "https://deno.land/std/http/server.ts"
import {
  acceptWebSocket,
  isWebSocketCloseEvent,
  isWebSocketPingEvent,
  WebSocket,
} from "https://deno.land/std/ws/mod.ts"
import {MessageType, Message, RoomInfo} from '../../room-info/src/models/api/Message.ts'

const sockets: WebSocket[] = []
class Room{
  participants:Map<string, string> = new Map()
  contents:Map<string, string> = new Map()
}
class Rooms{
  rooms:Map<string, Room> = new Map()
  get(name: string){
    const found = this.rooms.get(name)
    if (found){
      return found
    }
    const create = new Room()
    this.rooms.set(name, create)
    return create
  }
}
const rooms = new Rooms()


async function handleWs(sock: WebSocket) {
  sockets.push(sock)
  console.log("socket connected!");
  try {
    for await (const ev of sock) {
      if (typeof ev === "string") {
        // text message.
        //  console.log("ws:Text", ev);
        const msg = JSON.parse(ev) as Message
        if (msg.t === MessageType.REQUEST){
          //  send all stored contents
          const infos: RoomInfo[] = []
          rooms.rooms.forEach((room, name) => {
            const roomInfo:RoomInfo = {r: name, ps:[], cs:[]}
            room.participants.forEach((value, pid)=>{
              roomInfo.ps.push({p: pid, v:value})
            })
            room.contents.forEach((value, pid)=>{
              roomInfo.cs.push({p: pid, v:value})
            })
            infos.push(roomInfo)
          })
          const msg:Message = {
            t:MessageType.ALL_INFOS,
            r:'',
            p:'',
            v:JSON.stringify(infos)
          }
          sock.send(JSON.stringify(msg))
        }else{
          //  forward message to others
          sockets.forEach(s => s!==sock && s.send(ev))
          if (msg.t===MessageType.UPDATE_PARTICIPANT){
            rooms.get(msg.r).participants.set(msg.p, msg.v)
          }else if (msg.t===MessageType.UPDATE_CONTENTS){
            rooms.get(msg.r).contents.set(msg.p, msg.v)
          }else if (msg.t===MessageType.REMOVE_PARTICIPANT){
            rooms.get(msg.r).participants.delete(msg.p)
            rooms.get(msg.r).contents.delete(msg.p)
          }
        }
      } else if (ev instanceof Uint8Array) {
        // binary message.
        console.log("ws:Binary", ev);
      } else if (isWebSocketPingEvent(ev)) {
        const [, body] = ev;
        // ping.
        console.log("ws:Ping", body);
      } else if (isWebSocketCloseEvent(ev)) {
        // close.
        const idx = sockets.findIndex(s => s === sock)
        if (idx >= 0){
          sockets.splice(idx, 1)
        }else{
          console.error('sock to close not found.')
        }
        const { code, reason } = ev;
        console.log("ws:Close", code, reason);
      }
    }
  } catch (err) {
    console.error(`failed to receive frame: ${err}`);

    if (!sock.isClosed) {
      await sock.close(1000).catch(console.error);
    }
  }
}

if (import.meta.main) {
  /** websocket echo server */
  const port = Deno.args[0] || "8080";
  console.log(`websocket server is running on :${port}`);
  for await (const req of serve(`:${port}`)) {
    const { conn, r: bufReader, w: bufWriter, headers } = req;
    acceptWebSocket({
      conn,
      bufReader,
      bufWriter,
      headers,
    })
      .then(handleWs)
      .catch(async (err) => {
        console.error(`failed to accept websocket: ${err}`);
        await req.respond({ status: 400 });
      });
  }
}
