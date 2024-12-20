import { Injectable } from '@angular/core';
import { Router } from '@angular/router';
import { GameRoom } from '@app/interfaces/game';
import { CommunicationSocketService } from '@app/services/communication-socket/communication-socket.service';
import { GameService } from '@app/services/game/game.service';
import { GameMode } from '@common/game-mode';
import { Subject } from 'rxjs';

@Injectable({
    providedIn: 'root',
})
export class WaitingRoomService {
    rejected$ = new Subject<boolean>();
    accepted$ = new Subject<boolean>();
    gameCanceled$ = new Subject<boolean>();
    gameRoom: GameRoom;
    username: string;
    gameMode: string;
    constructor(private router: Router, private readonly socketService: CommunicationSocketService, private gameService: GameService) {}

    playerRejected(player: string): void {
        if (this.socketService.isSocketAlive()) {
            this.socketService.send('rejectPlayer', { roomId: this.gameRoom.roomId, username: player });
        }
    }

    playerAccepted(player: string): void {
        if (this.socketService.isSocketAlive()) {
            this.socketService.send('acceptPlayer', { roomId: this.gameRoom.roomId, username: player });
        }
    }

    abortGame(): void {
        if (this.socketService.isSocketAlive() && this.gameRoom?.userGame.username1 === this.username) {
            this.socketService.send('abortGameCreation', this.gameRoom.roomId);
        } else if (this.socketService.isSocketAlive() && this.gameRoom) {
            this.socketService.send('leaveGame', { roomId: this.gameRoom.roomId, username: this.username });
        }
        this.disconnectSocket();
        this.router.navigateByUrl('/', { skipLocationChange: true }).then(() => {
            this.router.navigate([this.gameMode === GameMode.classicMode ? '/selection' : '/home']);
        });
    }

    startGame(): void {
        this.gameService.startGame(this.gameRoom, this.username);
        this.router.navigate(['/game']);
    }

    createGame(gameRoom: GameRoom): void {
        this.gameRoom = gameRoom;
        this.username = this.gameRoom.userGame.username1;
        this.gameMode = this.gameRoom.gameMode;
        this.disconnectSocket();
        this.connectSocket();
        this.handleWaitingRoomSocket();
        this.socketService.send('createGame', this.gameRoom);
    }

    joinGame(username: string, gameMode: string, gameName = undefined as unknown as string): void {
        this.gameRoom = undefined as unknown as GameRoom;
        this.username = username;
        this.gameMode = gameMode;
        this.disconnectSocket();
        this.connectSocket();
        this.handleWaitingRoomSocket();
        this.socketService.send('askingToJoinGame', { gameName, username, gameMode });
    }

    handleWaitingRoomSocket(): void {
        this.socketService.on('gameInfo', (gameRoom: GameRoom) => {
            if (
                gameRoom &&
                (!this.gameRoom || this.gameRoom.userGame.gameData.name === gameRoom.userGame.gameData.name) &&
                this.gameMode === gameRoom.gameMode
            ) {
                this.gameRoom = gameRoom;
            } else if (!gameRoom) {
                alert('Nous avons eu un problème pour obtenir les informations de jeu du serveur');
            }
        });

        this.socketService.on('gameCreated', (roomId: string) => {
            if (roomId) {
                this.gameRoom.roomId = roomId;
                if (this.gameRoom.started) {
                    this.startGame();
                }
            } else if (!roomId) {
                alert('Nous avons eu un problème pour obtenir les informations de jeu du serveur');
            }
        });

        this.socketService.on('playerAccepted', (gameRoom: GameRoom) => {
            if (gameRoom && (gameRoom.userGame.username1 === this.username || gameRoom.userGame.username2 === this.username)) {
                this.gameRoom = gameRoom;
                this.accepted$.next(true);
            } else if (gameRoom) {
                this.gameRoom = gameRoom;
                this.rejected$.next(true);
            }
        });

        this.socketService.on('playerRejected', (gameRoom: GameRoom) => {
            if (
                gameRoom &&
                gameRoom.userGame.username1 !== this.username &&
                gameRoom.userGame.username2 !== this.username &&
                !gameRoom.userGame.potentialPlayers?.includes(this.username)
            ) {
                this.rejected$.next(true);
            } else if (gameRoom) {
                this.gameRoom = gameRoom;
            }
        });

        this.socketService.on('gameCanceled', (gameRoom: GameRoom) => {
            if (
                this.gameRoom?.userGame.gameData.name === gameRoom?.userGame.gameData.name &&
                this.gameRoom.gameMode === this.gameMode &&
                (gameRoom.userGame.username1 === this.username || gameRoom.userGame.potentialPlayers?.includes(this.username))
            ) {
                this.gameCanceled$.next(true);
            }
        });

        this.socketService.on('gameDeleted', (gameName: string) => {
            if (this.gameMode === GameMode.limitedTimeMode) {
                this.gameService.slides = this.gameService.slides.filter((slide) => slide.name !== gameName);
                if (this.gameService.slides.length === 0) {
                    this.gameCanceled$.next(true);
                }
            } else if (this.gameRoom.userGame.gameData.name === gameName) {
                this.gameCanceled$.next(true);
            }
        });
    }

    connectSocket(): void {
        if (!this.socketService.isSocketAlive()) {
            this.socketService.connect();
        }
    }

    disconnectSocket(): void {
        if (this.socketService.isSocketAlive()) {
            this.socketService.disconnect();
        }
    }
}
