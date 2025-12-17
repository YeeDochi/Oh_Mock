package org.example.oh_mock.controller;

import lombok.RequiredArgsConstructor;
import org.example.oh_mock.dto.GameMessage;
import org.example.oh_mock.service.GameService;
import org.springframework.messaging.handler.annotation.DestinationVariable;
import org.springframework.messaging.handler.annotation.MessageMapping;
import org.springframework.messaging.handler.annotation.SendTo;
import org.springframework.messaging.simp.SimpMessageHeaderAccessor;
import org.springframework.stereotype.Controller;

@Controller
@RequiredArgsConstructor
public class GameController {

    private final GameService gameService;

    @MessageMapping("/{roomId}/join")
    public void join(@DestinationVariable String roomId, GameMessage message, SimpMessageHeaderAccessor headerAccessor) {
        // 세션에 정보 저장 (Disconnect 이벤트 등에서 사용 가능)
        headerAccessor.getSessionAttributes().put("roomId", roomId);
        headerAccessor.getSessionAttributes().put("senderId", message.getSenderId());

        gameService.join(roomId, message);
    }

    @MessageMapping("/{roomId}/stone")
    public void putStone(@DestinationVariable String roomId, GameMessage message) {
        gameService.putStone(roomId, message);
    }

    @MessageMapping("/{roomId}/chat")
    @SendTo("/topic/{roomId}/chat")
    public GameMessage chat(@DestinationVariable String roomId, GameMessage message) {
        return message;
    }

    @MessageMapping("/{roomId}/start")
    public void startGame(@DestinationVariable String roomId) {
        gameService.Start(roomId);
    }

    @MessageMapping("/{roomId}/exit")
    public void exit(@DestinationVariable String roomId, GameMessage message) {
        gameService.exit(roomId, message);
    }
}