import {
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
  MessageBody,
  ConnectedSocket,
} from '@nestjs/websockets';
import { v4 as uuidV4 } from 'uuid';
import { Server, Socket } from 'socket.io';

const rooms: Record<string, Record<string, IUser>> = {};
const chats: Record<string, IMessage[]> = {};

interface ChangeNameMessage {
  peerId: string;
  userName: string;
  roomId: string
}

interface IRoomParams {
  roomId: string;
  peerId: string;
}

interface IUser {
  peerId: string;
  userName: string;
}

interface IMessage {
  content: string;
  userId?: string;
  timestamp: number;
}

interface MessageItem {
  roomId: string;
  message: IMessage
}

interface IJoinRoomParams extends IRoomParams {
  userName: string;
}

@WebSocketGateway({
  cors: {
    origin: '*',
    methods: ['POST', 'GET'],
  },
})
export class EventsGateway {
  @WebSocketServer() server: Server;

  @SubscribeMessage('ping')
  handlePing(@ConnectedSocket() client: Socket) {
    client.emit('pong');
  }

  @SubscribeMessage('join-room')
  handleJoinRoom(@ConnectedSocket() client: Socket, @MessageBody() data: IJoinRoomParams) {
    const { roomId, peerId, userName } = data;
    if (!rooms[roomId]) {
      client.emit('room-not-exist', { roomId });
      client.disconnect()
      return;
    }
    console.log(`有用户加入房间\n房间ID ${roomId} 用户ID ${peerId} 用户昵称 ${userName}`);
    rooms[roomId][peerId] = { peerId, userName };
    // 将新用户的socket加入指定房间
    client.join(roomId)
    // 发送给用户该房间所有消息记录
    client.emit("get-messages", chats[roomId])
    // 通知房间内的所有用户有用户加入房间
    this.server.to(roomId).emit('user-joined', { peerId, userName })
    // 通知房间内的所有用户当前房间的用户群体
    this.server.to(roomId).emit('get-users', {
      participants: rooms[roomId]
    })
    // 当用户退出房间时
    client.on('disconnect', () => {
      if (!rooms[roomId]) {
        return;
      }
      console.log(`用户ID ${peerId}离开房间`);
      // 删除对应用户在房间内的记录
      delete rooms[roomId][peerId]
      // 通知用户所属房间此用户退出房间
      this.server.to(roomId).emit('user-disconnected', { peerId: peerId })
      // 通知前端当前房间内用户群（可选）
      this.server.to(roomId).emit('get-users', {
        participants: rooms[roomId]
      })
    })
  }

  @SubscribeMessage('start-share-screen')
  handleStartShareScreen(@MessageBody() data: IRoomParams) {
    const { roomId, peerId } = data;
    this.server.to(roomId).emit("user-started-sharing", peerId);
  }

  @SubscribeMessage('stop-share-screen')
  handleStopShareScreen(@MessageBody() data: IRoomParams) {
    const { roomId, peerId } = data;
    this.server.to(roomId).emit("user-stoped-sharing", peerId);
  }

  @SubscribeMessage('change-name')
  handleChangeName(@MessageBody() data: ChangeNameMessage) {
    const { roomId, peerId, userName } = data;
    if (rooms[roomId] && rooms[roomId][peerId]) {
      rooms[roomId][peerId].userName = userName;
      this.server.to(roomId).emit("name-changed", { peerId, userName });
    }
  }

  @SubscribeMessage('send-message')
  handleSendMessage(@MessageBody() data: MessageItem) {
    const { roomId, message } = data;
    console.log(`用户 ${message.userId} 发送消息，消息内容 ${message.content}，房间ID ${roomId}`)
    if (chats[roomId]) {
      chats[roomId].push(message);
    } else {
      chats[roomId] = [message];
    }
    this.server.to(roomId).emit("add-message", message);
  }

  @SubscribeMessage('create-room')
  handleCreateRoom(@ConnectedSocket() client: Socket) {
    const roomId = uuidV4();
    rooms[roomId] = {};
    client.emit('room-created', { roomId });
    console.log(`用户创建房间\n房间ID ${roomId}`);
  }
}
