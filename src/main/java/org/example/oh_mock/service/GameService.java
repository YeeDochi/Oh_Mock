package org.example.oh_mock.service;

import lombok.RequiredArgsConstructor;
import org.example.oh_mock.dto.GameMessage;
import org.example.oh_mock.dto.GameRoom;
import org.example.oh_mock.dto.Player;
import org.springframework.messaging.simp.SimpMessagingTemplate;
import org.springframework.stereotype.Service;

@Service
@RequiredArgsConstructor
public class GameService {
    private final RoomService roomService;
    private final SimpMessagingTemplate messagingTemplate;

    // [입장]
    public void join(String roomId, GameMessage message){
        GameRoom room = roomService.findRoom(roomId);
        if (room == null) return;

        Player newPlayer = new Player(message.getSender(), message.getSenderId());
        newPlayer.setSkinUrl(message.getSkinUrl()); // 스킨 URL 저장

        room.assignSeat(newPlayer); // 흑/백 자동 배정

        // 입장 알림
        message.setContent(message.getSender() + "님이 입장하셨습니다.");
        message.setStoneType(newPlayer.getStoneType()); // 배정된 돌 정보 전송
        messagingTemplate.convertAndSend("/topic/" + roomId + "/chat", message);
    }

    // [착수: 돌 놓기]
    public synchronized void putStone(String roomId, GameMessage message) {
        GameRoom room = roomService.findRoom(roomId);
        if (room == null || !room.isPlaying()) return;

        int row = message.getRow();
        int col = message.getCol();
        int stoneType = message.getStoneType(); // 1(흑) or 2(백)

        // 유효성 검사: 현재 턴인가? 빈 칸인가?
        if (room.getCurrentTurn() != stoneType) return;
        if (room.getBoard()[row][col] != 0) return;

        // 1. 서버 메모리에 착수 기록
        room.getBoard()[row][col] = stoneType;

        // 2. 모든 클라이언트에게 착수 정보 전송 (그리기 요청)
        message.setType("STONE");
        messagingTemplate.convertAndSend("/topic/" + roomId + "/stone", message);

        // 3. 승리 판정
        if (checkWin(room.getBoard(), row, col, stoneType)) {
            room.setPlaying(false);
            room.setWinnerId(message.getSenderId());

            GameMessage winMsg = GameMessage.SystemChatMessage(
                    "🎉 " + message.getSender() + "님이 승리하셨습니다! 게임 종료.");
            winMsg.setType("GAME_OVER");
            messagingTemplate.convertAndSend("/topic/" + roomId + "/chat", winMsg);
        } else {
            // 4. 턴 넘기기
            room.setCurrentTurn(stoneType == 1 ? 2 : 1);
        }
    }

    // [승리 알고리즘: 5목 체크]
    private boolean checkWin(int[][] board, int x, int y, int stone) {
        int[] dx = {1, 0, 1, 1}; // 가로, 세로, 대각선, 역대각선
        int[] dy = {0, 1, 1, -1};

        for (int i = 0; i < 4; i++) {
            int count = 1;
            // 정방향 탐색
            for (int k = 1; k < 5; k++) {
                int nx = x + dx[i] * k;
                int ny = y + dy[i] * k;
                if (nx < 0 || ny < 0 || nx >= 15 || ny >= 15 || board[nx][ny] != stone) break;
                count++;
            }
            // 역방향 탐색
            for (int k = 1; k < 5; k++) {
                int nx = x - dx[i] * k;
                int ny = y - dy[i] * k;
                if (nx < 0 || ny < 0 || nx >= 15 || ny >= 15 || board[nx][ny] != stone) break;
                count++;
            }
            if (count >= 5) return true; // 5개 이상이면 승리
        }
        return false;
    }

    // [게임 시작]
    public void Start(String roomId) {
        GameRoom room = roomService.findRoom(roomId);
        if (room != null) {
            room.resetGame();
            GameMessage msg = GameMessage.SystemChatMessage("게임을 시작합니다! 흑돌부터 시작하세요.");
            msg.setType("START");
            messagingTemplate.convertAndSend("/topic/" + roomId + "/chat", msg);
        }
    }

    // [퇴장]
    public void exit(String roomId, GameMessage message){
        GameRoom room = roomService.findRoom(roomId);
        if (room != null) {
            Player p = new Player(message.getSender(), message.getSenderId());
            room.removeUser(p); // 흑/백 플레이어였다면 자리 비움 처리됨

            message.setContent(message.getSender() + "님이 퇴장하셨습니다.");
            messagingTemplate.convertAndSend("/topic/" + roomId + "/chat", message);

            if(room.getUsers().isEmpty()) {
                roomService.deleteRoom(roomId);
            } else if (room.isPlaying() && (room.getBlackPlayerId() == null || room.getWhitePlayerId() == null)) {
                // 게임 중인데 핵심 플레이어가 나가면 게임 중단
                room.setPlaying(false);
                messagingTemplate.convertAndSend("/topic/" + roomId + "/chat",
                        GameMessage.SystemChatMessage("플레이어 퇴장으로 게임이 중단되었습니다."));
            }
        }
    }
}