import socketio
import eventlet
import firebase_admin
from firebase_admin import credentials, firestore
import os
import json

try:
    firebase_creds_json = os.environ.get('FIREBASE_CREDENTIALS')
    
    if firebase_creds_json:
        # Production: Load from Environment Variable
        cred_dict = json.loads(firebase_creds_json)
        cred = credentials.Certificate(cred_dict)
        print("Loaded Firebase credentials from Environment Variable.")
    elif os.path.exists('serviceAccountKey.json'):
        # Development: Load from local file
        cred = credentials.Certificate('serviceAccountKey.json')
        print("Loaded Firebase credentials from local file.")
    else:
        raise FileNotFoundError("No Firebase credentials found.")

    firebase_admin.initialize_app(cred)
    db = firestore.client()
    print("Firebase Admin SDK initialized successfully.")
except Exception as e:
    print(f"Warning: Firebase initialization failed: {e}")
    print("Server will run in memory-only mode (Data won't save).")
    db = None

sio = socketio.Server(cors_allowed_origins='*')
app = socketio.WSGIApp(sio)

# Store game state in memory
rooms = {}

def check_win_condition(marked_indices):
    lines_complete = 0
    # Rows
    for r in range(5):
        if all((r * 5 + c) in marked_indices for c in range(5)):
            lines_complete += 1
    # Columns
    for c in range(5):
        if all((r * 5 + c) in marked_indices for r in range(5)):
            lines_complete += 1
    # Diagonals
    if all((i * 6) in marked_indices for i in range(5)): 
        lines_complete += 1
    if all((i * 4 + 4) in marked_indices for i in range(5)): 
        lines_complete += 1
    return lines_complete

def update_firestore_room(room_id, room_data):
    if not db: return
    try:
        firestore_data = {
            'status': room_data['status'],
            'turn': room_data['turn'],
            'players': {}
        }
        for sid, p_data in room_data['players'].items():
            firestore_data['players'][sid] = {
                'name': p_data['name'],
                'board': p_data['board'],
                'marked': p_data['marked'],
                'ready': p_data['ready']
            }
        db.collection('rooms').document(room_id).set(firestore_data, merge=True)
    except Exception as e:
        print(f"Error syncing to Firestore: {e}")

def delete_room(room_id):
    """Removes room from memory and Firestore"""
    if room_id in rooms:
        del rooms[room_id]
        print(f"Room {room_id} deleted from memory.")
    
    if db:
        try:
            db.collection('rooms').document(room_id).delete()
            print(f"Room {room_id} deleted from Firestore.")
        except Exception as e:
            print(f"Error deleting from Firestore: {e}")

@sio.event
def connect(sid, environ):
    print(f"Client connected: {sid}")

@sio.event
def disconnect(sid):
    print(f"Client disconnected: {sid}")
    # Find which room the player was in
    room_to_delete = None
    
    for room_id, room in rooms.items():
        if sid in room['players']:
            # Notify the other player if they exist
            sio.emit('opponent_left', room=room_id)
            room_to_delete = room_id
            break
            
    if room_to_delete:
        delete_room(room_to_delete)

@sio.on('join_room')
def handle_join(sid, data):
    room_id = data['roomId']
    player_name = data['name']
    
    if room_id not in rooms:
        rooms[room_id] = {'players': {}, 'status': 'waiting', 'turn': None, 'rematch': set()}
    
    current_room = rooms[room_id]
    
    if len(current_room['players']) >= 2:
        sio.emit('error', {'message': 'Room is full!'}, room=sid)
        return

    current_room['players'][sid] = {
        'name': player_name,
        'board': [],
        'marked': [],
        'ready': False
    }
    
    update_firestore_room(room_id, current_room)
    sio.enter_room(sid, room_id)
    
    sio.emit('player_joined', {'count': len(current_room['players']), 'players': [p['name'] for p in current_room['players'].values()]}, room=room_id)

@sio.on('submit_board')
def handle_board(sid, data):
    room_id = data['roomId']
    board = data['board']
    
    if room_id in rooms and sid in rooms[room_id]['players']:
        rooms[room_id]['players'][sid]['board'] = board
        rooms[room_id]['players'][sid]['ready'] = True
        
        players = rooms[room_id]['players']
        if len(players) == 2 and all(p['ready'] for p in players.values()):
            player_ids = list(players.keys())
            rooms[room_id]['status'] = 'playing'
            rooms[room_id]['turn'] = player_ids[0]
            sio.emit('game_start', {'turn': player_ids[0]}, room=room_id)
        
        update_firestore_room(room_id, rooms[room_id])

@sio.on('make_move')
def handle_move(sid, data):
    room_id = data['roomId']
    number = int(data['number'])
    
    room = rooms.get(room_id)
    if not room or room['status'] != 'playing': return
    if room['turn'] != sid: return

    opponent_sid = [k for k in room['players'] if k != sid][0]
    next_turn = opponent_sid
    room['turn'] = next_turn

    game_over = False
    winner_name = None

    for pid in room['players']:
        player = room['players'][pid]
        try:
            idx = player['board'].index(number)
            if idx not in player['marked']:
                player['marked'].append(idx)
        except ValueError: pass

        if check_win_condition(player['marked']) >= 5:
            game_over = True
            winner_name = player['name']
    
    if game_over:
        room['status'] = 'finished'
        if 'rematch' not in room: room['rematch'] = set()
        room['rematch'].clear()

    # Broadcast move and result
    sio.emit('move_made', {
        'number': number, 
        'nextTurn': next_turn,
        'gameOver': game_over,
        'winner': winner_name
    }, room=room_id)

    update_firestore_room(room_id, room)

@sio.on('play_again')
def handle_play_again(sid, data):
    room_id = data['roomId']
    if room_id not in rooms: return
    
    room = rooms[room_id]
    if 'rematch' not in room: room['rematch'] = set()
    
    room['rematch'].add(sid)
    sio.emit('rematch_status', {'count': len(room['rematch'])}, room=room_id)
    
    if len(room['rematch']) >= 2:
        for pid in room['players']:
            room['players'][pid]['board'] = []
            room['players'][pid]['marked'] = []
            room['players'][pid]['ready'] = False
        
        room['status'] = 'waiting'
        room['turn'] = None
        room['rematch'] = set()
        
        sio.emit('reset_game', room=room_id)
        update_firestore_room(room_id, room)

if __name__ == '__main__':
    port = int(os.environ.get("PORT", 5000))
    print(f"Starting Bingo Server on port {port}...")
    eventlet.wsgi.server(eventlet.listen(('0.0.0.0', port)), app)