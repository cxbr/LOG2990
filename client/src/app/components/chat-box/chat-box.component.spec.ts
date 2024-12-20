import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ChatBoxComponent } from '@app/components/chat-box/chat-box.component';
import { Message } from '@app/interfaces/chat';
import { GameData, GameRoom } from '@app/interfaces/game';
import { ChatService } from '@app/services/chat/chat.service';
import { VerifyInputService } from '@app/services/verify-input/verify-input.service';

describe('ChatBoxComponent', () => {
    let component: ChatBoxComponent;
    let fixture: ComponentFixture<ChatBoxComponent>;

    let messageStub: Message;
    let differenceMatrix: number[][];
    let gameData: GameData;
    let gameRoom: GameRoom;
    let chatService: ChatService;

    beforeEach(async () => {
        await TestBed.configureTestingModule({
            declarations: [ChatBoxComponent],
            providers: [ChatService, VerifyInputService],
        }).compileComponents();
        chatService = TestBed.inject(ChatService);
    });

    beforeEach(() => {
        differenceMatrix = [[]];
        gameData = { name: '', nbDifference: 0, image1url: '', image2url: '', difficulty: '', soloBestTimes: [], vsBestTimes: [], differenceMatrix };
        gameRoom = {
            userGame: { gameData, nbDifferenceFound: 0, timer: 0, username1: 'Test' },
            roomId: 'fakeId',
            started: false,
            gameMode: 'mode Classique',
        };
        messageStub = { message: 'message', username: 'username', time: 0 };
        fixture = TestBed.createComponent(ChatBoxComponent);
        component = fixture.componentInstance;
        fixture.detectChanges();
    });

    it('should create', () => {
        expect(component).toBeTruthy();
    });

    it('should subscribe to chatService.message$', () => {
        const messageSubSpy = spyOn(chatService.message$, 'subscribe').and.callThrough();
        component.ngOnInit();
        chatService.message$.next(messageStub);
        expect(messageSubSpy).toHaveBeenCalled();
        expect(component.messages).toContain(messageStub);
    });

    it('should call chatService.sendMessage() when sendMessage() is called and verify return true', () => {
        const verifyService = TestBed.inject(VerifyInputService);
        const verifySpy = spyOn(verifyService, 'verify').and.returnValue(true);
        const sendMessageSpy = spyOn(chatService, 'sendMessage').and.stub();
        component.message = 'message';
        component.username = 'username';
        component.gameRoom = gameRoom;
        component.sendMessage();
        expect(verifySpy).toHaveBeenCalledWith('message');
        expect(sendMessageSpy).toHaveBeenCalledWith('message', 'username', gameRoom.roomId);
    });

    it("shouldn't call chatService.sendMessage() when sendMessage() is called and verify return false", () => {
        const verifyService = TestBed.inject(VerifyInputService);
        const verifySpy = spyOn(verifyService, 'verify').and.returnValue(false);
        const sendMessageSpy = spyOn(chatService, 'sendMessage').and.stub();
        component.message = 'message';
        component.username = 'username';
        component.gameRoom = gameRoom;
        component.sendMessage();
        expect(verifySpy).toHaveBeenCalledWith('message');
        expect(sendMessageSpy).not.toHaveBeenCalledWith('message', 'username', gameRoom.roomId);
    });

    it('should call chatService.setIsTyping when chatInputFocus is called', () => {
        const setIsTypingSpy = spyOn(chatService, 'setIsTyping').and.stub();
        component.chatInputFocus();
        expect(setIsTypingSpy).toHaveBeenCalledWith(true);
    });

    it('should call chatService.setIsTyping when chatInputBlur is called', () => {
        const setIsTypingSpy = spyOn(chatService, 'setIsTyping').and.stub();
        component.chatInputBlur();
        expect(setIsTypingSpy).toHaveBeenCalledWith(false);
    });
});
