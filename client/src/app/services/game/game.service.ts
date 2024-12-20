import { Injectable } from '@angular/core';
import { DifferenceTry } from '@app/interfaces/difference-try';
import { EndGame, GameData, GameRoom, NewBestTime } from '@app/interfaces/game';
import { GameConstants } from '@app/interfaces/game-constants';
import { Vec2 } from '@app/interfaces/vec2';
import { ChatService } from '@app/services/chat/chat.service';
import { CommunicationHttpService } from '@app/services/communication-http/communication-http.service';
import { CommunicationSocketService } from '@app/services/communication-socket/communication-socket.service';
import { ConfigHttpService } from '@app/services/config-http/config-http.service';
import { Subject } from 'rxjs';
import { GameMode } from '@common/game-mode';
import { NOT_TOP3 } from 'src/assets/variables/constants';

@Injectable({
    providedIn: 'root',
})
export class GameService {
    gameExists$ = new Subject<boolean>();
    timePosition$ = new Subject<number>();
    serverValidateResponse$ = new Subject<DifferenceTry>();
    totalDifferencesFound$ = new Subject<number>();
    userDifferencesFound$ = new Subject<number>();
    timer$ = new Subject<number>();
    gameFinished$ = new Subject<boolean>();
    gameRoom$ = new Subject<GameRoom>();
    gameDeleted$ = new Subject<boolean>();
    abandoned$ = new Subject<string>();
    gameRoom: GameRoom;
    slides: GameData[];
    username: string;
    gameMode: string;
    gameConstants: GameConstants;
    userDifferencesFound = 0;
    isAbandoned = false;
    private canSendValidate = true;

    // eslint-disable-next-line max-params
    constructor(
        readonly socketService: CommunicationSocketService,
        private chatService: ChatService,
        readonly configHttpService: ConfigHttpService,
        private communicationService: CommunicationHttpService,
    ) {
        this.getConstant();
    }

    getIsTyping(): boolean {
        return this.chatService.getIsTyping();
    }

    getConstant(): void {
        this.configHttpService.getConstants().subscribe((res) => {
            this.gameConstants = res;
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

    isLimitedTimeMode(): boolean {
        return this.gameMode === GameMode.limitedTimeMode;
    }

    startGame(gameRoom: GameRoom, username: string): void {
        this.gameRoom = gameRoom;
        this.username = username;
        this.gameMode = gameRoom.gameMode;
        this.gameRoom$.next(this.gameRoom);
        if (this.gameRoom.userGame.username1 === this.username) {
            this.connectSocket();
            this.socketService.send('start', this.gameRoom.roomId);
        }
        if (this.gameMode === GameMode.limitedTimeMode) {
            this.getAllGames();
            this.gameDeletedSocket();
        }
        this.chatService.handleMessage();
        this.handleSocket();
    }

    gameDeletedSocket(): void {
        this.socketService.on('gameCanceled', (gameName: string) => {
            this.slides = this.slides.filter((game) => game.name !== gameName);
        });
    }

    sendMessage(message: string, username: string): void {
        this.chatService.sendMessage(message, username, this.gameRoom.roomId);
    }

    turnOffWaitingSocket(): void {
        this.socketService.off('gameInfo');
        this.socketService.off('gameCreated');
        this.socketService.off('playerAccepted');
        this.socketService.off('playerRejected');
        this.socketService.off('gameCanceled');
    }

    getAllGames() {
        this.communicationService.getAllGames().subscribe((games) => {
            games.forEach((game) => {
                this.communicationService.getGame(game.name).subscribe((gameData) => {
                    game.differenceMatrix = gameData.differenceMatrix;
                });
            });
            this.slides = games;
            this.slides = this.slides.filter((game) => game.name !== this.gameRoom.userGame.gameData.name);
        });
    }

    abortGame(): void {
        if (this.socketService.isSocketAlive() && this.gameRoom.userGame.username1 === this.username) {
            this.socketService.send('abortGameCreation', this.gameRoom.roomId);
        } else if (this.socketService.isSocketAlive() && this.gameRoom) {
            this.socketService.send('leaveGame', { roomId: this.gameRoom.roomId, username: this.username });
        }
        this.disconnectSocket();
    }

    sendServerValidate(differencePos: Vec2): void {
        if (!this.canSendValidate) {
            return;
        }
        this.socketService.send('validate', { differencePos, roomId: this.gameRoom.roomId, username: this.username });
        this.canSendValidate = false;
    }

    endGame(gameFinished: boolean, winner: boolean): void {
        if (this.socketService.isSocketAlive()) {
            const endGame = {} as EndGame;
            endGame.gameFinished = gameFinished;
            endGame.winner = winner;
            endGame.roomId = this.gameRoom.roomId;
            endGame.username = this.username;
            this.socketService.send('endGame', endGame);
            if (this.gameMode === GameMode.classicMode) this.updateBestTime(gameFinished, winner);
        }
    }

    changeTime(number: number): void {
        if (this.socketService.isSocketAlive()) {
            this.socketService.send('changeTime', { roomId: this.gameRoom.roomId, time: number });
        }
    }

    reset(): void {
        this.disconnectSocket();
        this.gameRoom = undefined as unknown as GameRoom;
        this.canSendValidate = true;
        this.username = '';
        this.userDifferencesFound = 0;
        this.totalDifferencesFound$ = new Subject<number>();
        this.userDifferencesFound$ = new Subject<number>();
        this.timer$ = new Subject<number>();
        this.gameFinished$ = new Subject<boolean>();
        this.gameRoom$ = new Subject<GameRoom>();
        this.serverValidateResponse$ = new Subject<DifferenceTry>();
        this.abandoned$ = new Subject<string>();
    }

    abandonGame(): void {
        if (this.socketService.isSocketAlive()) {
            this.socketService.send('abandoned', { roomId: this.gameRoom.roomId, username: this.username });
        }
    }

    nextGame(): void {
        const game = this.slides.pop();
        if (game) {
            this.gameRoom.userGame.gameData = game;
            this.gameRoom$.next(this.gameRoom);
            this.socketService.send('nextGame', this.gameRoom);
        } else {
            this.gameFinished$.next(true);
        }
    }

    private updateBestTime(gameFinished: boolean, winner: boolean): void {
        this.configHttpService.getBestTime(this.gameRoom.userGame.gameData.name).subscribe((bestTimes) => {
            if (!bestTimes) return;
            const actualBestTime = this.gameRoom.userGame.username2 ? bestTimes.vsBestTimes[2].time : bestTimes.soloBestTimes[2].time;
            if (this.gameRoom.userGame.timer < actualBestTime && winner && gameFinished && !this.isAbandoned) {
                const newBestTime = new NewBestTime();
                newBestTime.gameName = this.gameRoom.userGame.gameData.name;
                newBestTime.time = this.gameRoom.userGame.timer;
                newBestTime.name = this.username;
                newBestTime.isSolo = !this.gameRoom.userGame.username2;
                this.configHttpService.updateBestTime(this.gameRoom.userGame.gameData.name, newBestTime).subscribe((position) => {
                    if (position === NOT_TOP3) return;
                    this.timePosition$.next(position);
                });
            }
        });
    }

    private handleSocket(): void {
        this.socketService.on('started', () => {
            this.gameRoom$.next(this.gameRoom);
        });

        this.socketService.on('validated', (differenceTry: DifferenceTry) => {
            if (differenceTry.validated) {
                this.gameRoom.userGame.nbDifferenceFound++;
                this.totalDifferencesFound$.next(this.gameRoom.userGame.nbDifferenceFound);
                if (differenceTry.username === this.username) {
                    this.userDifferencesFound++;
                    this.userDifferencesFound$.next(this.userDifferencesFound);
                }
            }
            this.serverValidateResponse$.next(differenceTry);
        });

        this.socketService.on('GameFinished', () => {
            this.gameFinished$.next(true);
            this.disconnectSocket();
        });

        this.socketService.on('abandoned', (data: { gameRoom: GameRoom; username: string }) => {
            this.isAbandoned = true;
            this.abandoned$.next(data.username);
            if (this.gameMode === GameMode.limitedTimeMode) {
                this.limitedTimeGameAbandoned(data.gameRoom);
            }
        });

        this.socketService.on('timer', (timer: number) => {
            if (this.gameRoom.userGame.timer <= 0 && this.gameMode === GameMode.limitedTimeMode) {
                this.gameFinished$.next(true);
            }
            this.gameRoom.userGame.timer = timer;
            this.timer$.next(timer);
            this.canSendValidate = true;
        });
    }

    private limitedTimeGameAbandoned(gameRoom: GameRoom): void {
        this.gameRoom = gameRoom;
        this.gameRoom$.next(this.gameRoom);
    }
}
