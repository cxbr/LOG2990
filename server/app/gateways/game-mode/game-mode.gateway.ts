import { DELAY_BETWEEN_EMISSIONS } from '@app/constants/constants';
import { GameModeEvents } from '@app/enum/game-mode.gateway.variables';
import { EndGame } from '@app/model/schema/end-game.schema';
import { GameRoom } from '@app/model/schema/game-room.schema';
import { Vector2D } from '@app/model/schema/vector2d.schema';
import { GameModeService } from '@app/services/game-mode/game-mode.service';
import { GameMode } from '@common/game-mode';
import { Injectable, Logger } from '@nestjs/common';
import { OnGatewayConnection, OnGatewayDisconnect, OnGatewayInit, SubscribeMessage, WebSocketGateway, WebSocketServer } from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';

@WebSocketGateway({ cors: true })
@Injectable()
export class GameModeGateway implements OnGatewayConnection, OnGatewayDisconnect, OnGatewayInit {
    @WebSocketServer() private server: Server;

    constructor(private readonly logger: Logger, private readonly gameModeService: GameModeService) {}

    @SubscribeMessage(GameModeEvents.ValidateDifference)
    validateDifference(socket: Socket, data: { differencePos: Vector2D; roomId: string; username: string }): void {
        const validated = this.gameModeService.validateDifference(data.roomId, data.differencePos);
        this.server
            .to(data.roomId)
            .emit(GameModeEvents.DifferenceValidated, { validated, differencePos: data.differencePos, username: data.username });
        if (this.gameModeService.isGameFinished(data.roomId)) {
            const endGame = {
                gameFinished: true,
                winner: true,
                roomId: data.roomId,
                username: data.username,
            };
            this.endGame(socket, endGame);
        }
    }

    @SubscribeMessage(GameModeEvents.EndGame)
    endGame(_socket: Socket, endGame: EndGame): void {
        const gameRoom = this.gameModeService.getGameRoom(endGame.roomId);
        if (!gameRoom || !endGame) return;
        this.logger.log(`Game mode gateway: End of game: ${gameRoom.userGame.gameData.name}`);
        this.server.to(endGame.roomId).emit(GameModeEvents.GameFinished);
        this.gameModeService.endGame(endGame);
    }

    @SubscribeMessage(GameModeEvents.Abandoned)
    abandoned(socket: Socket, data: { roomId: string; username: string }): void {
        const gameRoom = this.gameModeService.getGameRoom(data.roomId);
        if (!gameRoom) return;
        if (gameRoom.gameMode === GameMode.classicMode) {
            this.gameModeService.abandonClassicMode(gameRoom, data.username);
            this.logger.log(`Game mode gateway: ${data.username}: abandoned classic mode game`);
            this.server.to(data.roomId).emit(GameModeEvents.Abandoned, { gameRoom, username: data.username });
        } else {
            const sockets = this.server.sockets.adapter.rooms.get(data.roomId);
            sockets.delete(socket.id);
            if (socket.id === gameRoom.roomId && gameRoom.userGame.username2) {
                socket.leave(data.roomId);
                gameRoom.roomId = Array.from(sockets.keys())[0];
            } else {
                socket.leave(socket.id);
            }
            this.gameModeService.abandonLimitedTimeMode(gameRoom, data.username, data.roomId);
            this.server.to(gameRoom.roomId).emit(GameModeEvents.Abandoned, { gameRoom, username: data.username });
        }
    }

    @SubscribeMessage(GameModeEvents.ChangeTime)
    changeTime(_socket: Socket, data: { roomId: string; time: number }): void {
        this.logger.log(`Game mode gateway: Time changed: ${data.time}`);
        this.gameModeService.applyTimeToTimer(data.roomId, data.time);
    }

    @SubscribeMessage(GameModeEvents.NextGame)
    nextGame(_socket: Socket, gameRoom: GameRoom): void {
        this.gameModeService.nextGame(gameRoom);
    }

    afterInit(): void {
        setInterval(() => {
            this.emitTime();
        }, DELAY_BETWEEN_EMISSIONS);
    }

    handleConnection(socket: Socket): void {
        this.logger.log(`Game mode gateway: Connection of user with id: ${socket.id}`);
    }

    handleDisconnect(socket: Socket): void {
        const gameRoom = this.gameModeService.getGameRoom(socket.id);
        if (!gameRoom || !gameRoom.started) return;
        if (gameRoom.userGame.username2) {
            this.abandoned(socket, { roomId: socket.id, username: gameRoom.userGame.username2 });
            return;
        }
        this.logger.log(`Game mode gateway: ${socket.id}: disconnected`);
        this.logger.log(`Game deleted: ${gameRoom.userGame.gameData.name}`);
        this.server.emit(GameModeEvents.GameDeleted, { gameName: gameRoom.userGame.gameData.name, gameMode: gameRoom.gameMode });
        this.gameModeService.deleteGameRoom(socket.id);
    }

    emitTime(): void {
        for (const gameRoom of this.gameModeService.getRoomsValues()) {
            if (gameRoom.started) {
                this.gameModeService.updateTimer(gameRoom);
                this.server.to(gameRoom.roomId).emit(GameModeEvents.Timer, gameRoom.userGame.timer);
            }
        }
    }

    cancelDeletedGame(gameName: string): void {
        this.logger.log(`Game mode gateway: Game canceled: ${gameName}`);
        this.server.emit(GameModeEvents.GameDeleted, gameName);
    }
}
