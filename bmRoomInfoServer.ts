// Copyright 2018-2021 the Deno authors. All rights reserved. MIT license.
import { serve } from "https://deno.land/std/http/server.ts"
import { serveTLS } from "https://deno.land/std/http/server.ts"
import {
  acceptWebSocket,
  isWebSocketCloseEvent,
  isWebSocketPingEvent,
  WebSocket,
} from "https://deno.land/std/ws/mod.ts"
import {MessageType, Message, RoomInfo} from './Message.ts'

const viewerSocks: WebSocket[] = []
class Room{
  participants:Map<string, string> = new Map()
  contents:Map<string, string> = new Map()
  properties: Map<string, string> = new Map()
  socks: WebSocket[] = []
  show = false
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
  clear(){
    this.rooms.forEach(room => {
      room.contents = new Map()
      room.participants = new Map()
    })
  }
}
const rooms = new Rooms()


async function handleWs(sock: WebSocket) {
  viewerSocks.push(sock)
  console.log(`New connection starts. we have ${viewerSocks.length} viewerSocks.`);
  try {
    for await (const ev of sock) {
      if (typeof ev === "string") {
        // text message.
        //  console.log("ws:Text", ev);
        const msg = JSON.parse(ev) as Message
        if (msg.t === MessageType.REQUEST){ //  send all stored contents
          const infos: RoomInfo[] = []
          rooms.rooms.forEach((room, name) => {
            if (!room.show) { return }
            infos.push({r: name,
              ps:Array.from(room.participants.entries()).map(p => ({p: p[0], v: p[1]})),
              cs:Array.from(room.contents.entries()).map(c => ({p:c[0], v:c[1]}))
            })
          })
          const msg:Message = { t:MessageType.ALL_INFOS, r:'', p:'', v:JSON.stringify(infos) }
          sock.send(JSON.stringify(msg))
        }else if (msg.t === MessageType.CLEAR){
          rooms.clear()
          viewerSocks.forEach(s => s!==sock && s.send(ev))
        }else if (msg.t === MessageType.ROOMS_TO_SHOW){
          const roomNames = JSON.parse(msg.v) as string[]
          console.log(JSON.stringify(msg))
          roomNames.forEach(roomName => rooms.get(roomName).show = true)
        }else if (msg.t === MessageType.REQUEST_ROOM_PROPS){
          console.log(ev)
          const room = rooms.get(msg.r)
          const idx = viewerSocks.findIndex(s => s === sock)
          if (idx >= 0){
            viewerSocks.splice(idx, 1)
            room.socks.push(sock)
          }
          console.log(`room:${msg.r} ${room.socks.length} socks.`)

          const rMsg:Message = {t:MessageType.ROOM_PROPS, r:msg.r, p:'', v: JSON.stringify(Array.from(room.properties.entries())) }
          sock.send(JSON.stringify(rMsg))
          console.log(JSON.stringify(rMsg))
        }else if (msg.t === MessageType.ROOM_PROP){
          const room = rooms.get(msg.r)
          room.socks.forEach(s => s.send(JSON.stringify(msg)))  //  forward and echo message
          const prop = JSON.parse(msg.v)  //  update store
          room.properties.set(prop[0], prop[1])
        }else{
          //  forward message to others
          viewerSocks.forEach(s => s!==sock && s.send(ev))
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
        const { code, reason } = ev;
        const idx = viewerSocks.findIndex(s => s === sock)
        if (idx >= 0){
          viewerSocks.splice(idx, 1)
          console.log(`ws:Closed. ${viewerSocks.length} viewerSocks remain`, code, reason);
        }else{
          let found = false
          rooms.rooms.forEach((room, name) => {
            const idx = room.socks.findIndex(s => s === sock)
            if (idx >= 0){
              room.socks.splice(idx, 1)
              console.log(`ws:Closed. room:${name} ${room.socks.length} socks remain`, code, reason);
              found = true
            }
          })
          if (!found){ console.error('sock to close not found.') }
        }
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
  const port = Deno.args[0] || "7443";
  const TLS = Deno.args[1] || false;
  console.log(`Websocket server is running on :${port}${TLS ? ' with TLS' : ''}.`);
  for await (const req of (
    TLS ? serveTLS({port:Number(port), certFile:'./host.crt', keyFile:'./host.key'}) 
      : serve(`:${port}`)
    )) {
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
