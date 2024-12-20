import { WaitingRoomEvents } from '@app/enum/waiting-room.gateway.variables';
import { GameRoom } from '@app/model/schema/game-room.schema';
import { GameModeService } from '@app/services/game-mode/game-mode.service';
import { GameMode } from '@common/game-mode';
import { Injectable, Logger } from '@nestjs/common';
import { OnGatewayDisconnect, SubscribeMessage, WebSocketGateway, WebSocketServer } from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';

@WebSocketGateway({ cors: true })
@Injectable()
export class WaitingRoomGateway implements OnGatewayDisconnect {
    @WebSocketServer() private server: Server;

    constructor(private readonly logger: Logger, private readonly gameModeService: GameModeService) {}

    @SubscribeMessage(WaitingRoomEvents.Start)
    startGame(_socket: Socket, roomId: string): void {
        const gameRoom = this.gameModeService.getGameRoom(roomId);
        this.gameModeService.saveGameHistory(gameRoom);
        this.logger.log(`Waiting room gateway: Launching the game: ${gameRoom.userGame.gameData.name}`);
        this.server.to(roomId).emit(WaitingRoomEvents.Started);
    }

    @SubscribeMessage(WaitingRoomEvents.CreateGame)
    createGame(socket: Socket, gameRoom: GameRoom): void {
        this.gameModeService.initNewRoom(socket, gameRoom);
        this.logger.log(`Waiting room gateway: Create the game: ${gameRoom.userGame.gameData.name}`);
        this.server.to(gameRoom.roomId).emit(WaitingRoomEvents.GameCreated, gameRoom.roomId);
        if (!gameRoom.started) {
            this.server.emit(WaitingRoomEvents.GameFound, { gameName: gameRoom.userGame.gameData.name, gameMode: gameRoom.gameMode });
        }
    }

    @SubscribeMessage(WaitingRoomEvents.AskingToJoinGame)
    joinGame(socket: Socket, data: { gameName: string; username: string; gameMode: string }): void {
        if (this.gameModeService.joinGame(socket, data)) {
            const gameRoom = this.gameModeService.getGameRoom(undefined, data.gameName, data.gameMode);
            this.logger.log(`Waiting room gateway: ${data.username} joined the game: ${gameRoom.userGame.gameData.name}`);
            if (data.gameMode === GameMode.limitedTimeMode) this.playerAccepted(socket, { roomId: gameRoom.roomId, username: data.username });
            this.server.emit(WaitingRoomEvents.GameInfo, gameRoom);
        } else {
            this.logger.log(`Waiting room gateway: Jeu: ${data.gameName} not found`);
            this.server.emit(WaitingRoomEvents.GameInfo, undefined);
        }
    }

    @SubscribeMessage(WaitingRoomEvents.AbortGameCreation)
    abortGameCreation(_socket: Socket, roomId: string): void {
        const gameRoom = this.gameModeService.getGameRoom(roomId);
        if (!gameRoom) return;
        this.logger.log(`Waiting room gateway: Game creation aborted: ${gameRoom.userGame.gameData.name}`);
        this.gameModeService.deleteGameRoom(roomId);
        this.server.emit(WaitingRoomEvents.GameDeleted, { gameName: gameRoom.userGame.gameData.name, gameMode: gameRoom.gameMode });
        this.server.emit(WaitingRoomEvents.GameCanceled, gameRoom);
    }

    @SubscribeMessage(WaitingRoomEvents.RejectPlayer)
    playerRejected(_socket: Socket, playerInfo: { roomId: string; username: string }): void {
        const gameRoom = this.gameModeService.getGameRoom(playerInfo.roomId);
        if (gameRoom) {
            this.logger.log(`Waiting room gateway: ${playerInfo.username} rejected from game: ${gameRoom.userGame.gameData.name}`);
            gameRoom.userGame.potentialPlayers = gameRoom.userGame.potentialPlayers.filter((player) => player !== playerInfo.username);
            this.gameModeService.setGameRoom(gameRoom);
            this.server.to(gameRoom.roomId).emit(WaitingRoomEvents.PlayerRejected, gameRoom);
        }
    }

    @SubscribeMessage(WaitingRoomEvents.AcceptPlayer)
    playerAccepted(_socket: Socket, playerInfo: { roomId: string; username: string }): void {
        const gameRoom = this.gameModeService.getGameRoom(playerInfo.roomId);
        if (gameRoom) {
            this.logger.log(`Waiting room gateway: ${playerInfo.username} accepted in game:  ${gameRoom.userGame.gameData.name}`);
            gameRoom.userGame.potentialPlayers = [];
            gameRoom.userGame.username2 = playerInfo.username;
            gameRoom.started = true;
            this.gameModeService.setGameRoom(gameRoom);
            this.server.to(gameRoom.roomId).emit(WaitingRoomEvents.PlayerAccepted, gameRoom);
        }
    }

    @SubscribeMessage(WaitingRoomEvents.LeaveGame)
    leaveGame(_socket: Socket, playerInfo: { roomId: string; username: string }): void {
        const gameRoom = this.gameModeService.getGameRoom(playerInfo.roomId);
        if (!gameRoom) return;
        this.logger.log(`Waiting room gateway: ${playerInfo.username} left the game: ${gameRoom.userGame.gameData.name}`);
        gameRoom.userGame.potentialPlayers = gameRoom.userGame.potentialPlayers.filter((player) => player !== playerInfo.username);
        this.gameModeService.setGameRoom(gameRoom);
        this.server.to(gameRoom.roomId).emit(WaitingRoomEvents.GameInfo, gameRoom);
    }

    handleDisconnect(socket: Socket): void {
        const gameRoom = this.gameModeService.getGameRoom(socket.id);
        if (!gameRoom || gameRoom.started) return;
        this.logger.log(`Waiting room gateway: ${socket.id}: disconnected`);
        if (gameRoom.roomId === socket.id) this.abortGameCreation(socket, socket.id);
        else this.leaveGame(socket, { roomId: gameRoom.roomId, username: gameRoom.userGame.username2 });
    }
}
