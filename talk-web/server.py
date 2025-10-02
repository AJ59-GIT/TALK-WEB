from flask import Flask, send_from_directory, request, jsonify, session, redirect, url_for
from flask_socketio import SocketIO, emit, join_room, leave_room
from werkzeug.security import generate_password_hash, check_password_hash
from functools import wraps
import os
import json
import sqlite3
from datetime import datetime

app = Flask(__name__, static_folder='')
app.secret_key = 'your_secret_key_here'  # Change this to a secure random key in production

# Initialize Flask-SocketIO
socketio = SocketIO(app, cors_allowed_origins="*", manage_session=False)

USERS_FILE = 'users.json'
DB_FILE = 'messages.db'

# Track online users: {email: socket_id}
online_users = {}

# Initialize SQLite database
def init_db():
    conn = sqlite3.connect(DB_FILE)
    cursor = conn.cursor()
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS messages (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            sender TEXT NOT NULL,
            receiver TEXT NOT NULL,
            text TEXT NOT NULL,
            timestamp TEXT NOT NULL,
            room_id TEXT NOT NULL
        )
    ''')
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS contacts (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_email TEXT NOT NULL,
            contact_email TEXT NOT NULL,
            added_at TEXT NOT NULL,
            UNIQUE(user_email, contact_email)
        )
    ''')
    conn.commit()
    conn.close()

init_db()

def add_contact(user_email, contact_email):
    """Add a contact for a user"""
    conn = sqlite3.connect(DB_FILE)
    cursor = conn.cursor()
    timestamp = datetime.now().strftime('%Y-%m-%d %H:%M:%S')
    try:
        cursor.execute('''
            INSERT INTO contacts (user_email, contact_email, added_at)
            VALUES (?, ?, ?)
        ''', (user_email, contact_email, timestamp))
        conn.commit()
        conn.close()
        return True
    except sqlite3.IntegrityError:
        conn.close()
        return False  # Contact already exists

def get_contacts(user_email):
    """Get all contacts for a user"""
    conn = sqlite3.connect(DB_FILE)
    cursor = conn.cursor()
    cursor.execute('''
        SELECT contact_email, added_at
        FROM contacts
        WHERE user_email = ?
        ORDER BY added_at DESC
    ''', (user_email,))
    contacts = cursor.fetchall()
    conn.close()
    return [{'email': c[0], 'added_at': c[1]} for c in contacts]

def remove_contact(user_email, contact_email):
    """Remove a contact"""
    conn = sqlite3.connect(DB_FILE)
    cursor = conn.cursor()
    cursor.execute('''
        DELETE FROM contacts
        WHERE user_email = ? AND contact_email = ?
    ''', (user_email, contact_email))
    conn.commit()
    conn.close()

def get_room_id(user1, user2):
    """Generate a consistent room ID for two users"""
    users = sorted([user1, user2])
    return f"{users[0]}_{users[1]}"

def save_message(sender, receiver, text, timestamp):
    """Save a message to the database"""
    room_id = get_room_id(sender, receiver)
    conn = sqlite3.connect(DB_FILE)
    cursor = conn.cursor()
    cursor.execute('''
        INSERT INTO messages (sender, receiver, text, timestamp, room_id)
        VALUES (?, ?, ?, ?, ?)
    ''', (sender, receiver, text, timestamp, room_id))
    conn.commit()
    conn.close()

def get_message_history(room_id, limit=50):
    """Retrieve message history for a specific room"""
    conn = sqlite3.connect(DB_FILE)
    cursor = conn.cursor()
    cursor.execute('''
        SELECT sender, receiver, text, timestamp
        FROM messages
        WHERE room_id = ?
        ORDER BY id DESC
        LIMIT ?
    ''', (room_id, limit))
    messages = cursor.fetchall()
    conn.close()
    
    # Reverse to get chronological order
    messages.reverse()
    
    return [
        {
            'sender': msg[0],
            'receiver': msg[1],
            'text': msg[2],
            'timestamp': msg[3]
        }
        for msg in messages
    ]

def load_users():
    if os.path.exists(USERS_FILE):
        with open(USERS_FILE, 'r') as f:
            return json.load(f)
    return {}

def save_users(users):
    with open(USERS_FILE, 'w') as f:
        json.dump(users, f)

def login_required(f):
    @wraps(f)
    def decorated_function(*args, **kwargs):
        if 'user' not in session:
            return redirect(url_for('login'))
        return f(*args, **kwargs)
    return decorated_function

@app.route('/register', methods=['GET', 'POST'])
def register():
    if request.method == 'POST':
        email = request.form.get('email')
        password = request.form.get('password')
        if not email or not password:
            return 'Email and password are required', 400
        users = load_users()
        if email in users:
            return 'User already exists', 400
        users[email] = {'password': generate_password_hash(password)}
        save_users(users)
        return redirect(url_for('login'))
    return send_from_directory('', 'register.html')

@app.route('/login', methods=['GET', 'POST'])
def login():
    if request.method == 'POST':
        email = request.form['email']
        password = request.form['password']
        users = load_users()
        # Fix for users data format: if value is string, convert to dict with password key
        if email in users:
            user_data = users[email]
            if isinstance(user_data, str):
                user_data = {'password': user_data}
                users[email] = user_data
                save_users(users)
            if check_password_hash(user_data['password'], password):
                session['user'] = email
                return redirect(url_for('serve_index'))
        return 'Invalid credentials', 401
    return send_from_directory('', 'login.html')

@app.route('/logout')
def logout():
    session.pop('user', None)
    return redirect(url_for('login'))

@app.route('/profile', methods=['GET', 'POST'])
@login_required
def profile():
    user_email = session['user']
    if request.method == 'POST':
        data = request.get_json()
        new_email = data.get('email')
        new_password = data.get('password')
        users = load_users()
        if new_email and new_email != user_email:
            if new_email in users:
                return jsonify({'error': 'Email already in use'}), 400
            # Update email
            users[new_email] = users.pop(user_email)
            session['user'] = new_email
            user_email = new_email
        if new_password:
            users[user_email]['password'] = generate_password_hash(new_password)
        save_users(users)
        return jsonify({'message': 'Profile updated successfully'})
    else:
        return jsonify({'email': user_email})

@app.route('/')
@login_required
def serve_index():
    return send_from_directory('', 'index.html')

@app.route('/api/search_users', methods=['GET'])
@login_required
def search_users():
    """Search for users by email or partial email"""
    query = request.args.get('query', '').lower().strip()
    current_user = session['user']
    
    if not query:
        return jsonify({'users': []}), 200
    
    users = load_users()
    
    # Search for users matching the query
    matching_users = []
    for email in users.keys():
        if email != current_user and query in email.lower():
            matching_users.append({
                'email': email,
                'username': email.split('@')[0]
            })
    
    return jsonify({'users': matching_users}), 200

@app.route('/api/contacts', methods=['GET', 'POST', 'DELETE'])
@login_required
def manage_contacts():
    """Manage user contacts"""
    user_email = session['user']
    
    if request.method == 'GET':
        # Get all contacts for current user
        contacts = get_contacts(user_email)
        
        # Enrich contacts with online status
        enriched_contacts = []
        for contact in contacts:
            is_online = contact['email'] in online_users
            enriched_contacts.append({
                'email': contact['email'],
                'username': contact['email'].split('@')[0],
                'status': 'online' if is_online else 'offline',
                'added_at': contact['added_at']
            })
        
        return jsonify({'contacts': enriched_contacts}), 200
    
    elif request.method == 'POST':
        # Add a new contact
        data = request.get_json()
        contact_email = data.get('contact_email')
        
        if not contact_email:
            return jsonify({'error': 'Contact email is required'}), 400
        
        if contact_email == user_email:
            return jsonify({'error': 'Cannot add yourself as a contact'}), 400
        
        # Check if user exists
        users = load_users()
        if contact_email not in users:
            return jsonify({'error': 'User does not exist'}), 404
        
        # Add contact
        success = add_contact(user_email, contact_email)
        if success:
            return jsonify({'message': 'Contact added successfully'}), 200
        else:
            return jsonify({'error': 'Contact already exists'}), 400
    
    elif request.method == 'DELETE':
        # Remove a contact
        data = request.get_json()
        contact_email = data.get('contact_email')
        
        if not contact_email:
            return jsonify({'error': 'Contact email is required'}), 400
        
        remove_contact(user_email, contact_email)
        return jsonify({'message': 'Contact removed successfully'}), 200

@app.route('/<path:path>')
def serve_static(path):
    # Fix for avatar image 404 errors: strip leading slash if present
    if path.startswith('/'):
        path = path[1:]
    if os.path.exists(path):
        return send_from_directory('', path)
    # Try serving from attached_assets folder if not found in root
    alt_path = os.path.join('attached_assets', path)
    if os.path.exists(alt_path):
        return send_from_directory('attached_assets', path)
    else:
        return "Not Found", 404

# WebSocket event handlers
@socketio.on('connect')
def handle_connect():
    """Handle client connection"""
    print(f'Client connected: {request.sid}')
    emit('connection_response', {'status': 'connected', 'message': 'Successfully connected to server'})

@socketio.on('user_login')
def handle_user_login(data):
    """Register user as online when they log in"""
    user_email = data.get('email')
    if user_email:
        online_users[user_email] = request.sid
        print(f'User {user_email} is now online (socket: {request.sid})')
        
        # Broadcast user status to all clients
        emit('user_status_update', {
            'email': user_email,
            'status': 'online'
        }, broadcast=True)

@socketio.on('disconnect')
def handle_disconnect():
    """Handle client disconnection and update online status"""
    # Find and remove user from online_users
    disconnected_user = None
    for email, sid in list(online_users.items()):
        if sid == request.sid:
            disconnected_user = email
            del online_users[email]
            break
    
    if disconnected_user:
        print(f'User {disconnected_user} disconnected')
        # Broadcast user offline status to all clients
        emit('user_status_update', {
            'email': disconnected_user,
            'status': 'offline'
        }, broadcast=True)
    else:
        print(f'Client disconnected: {request.sid}')

@socketio.on('join')
def handle_join(data):
    """Allow users to join specific chat rooms"""
    room = data.get('room')
    if room:
        join_room(room)
        print(f'Client {request.sid} joined room: {room}')
        emit('room_joined', {'room': room}, room=request.sid)

@socketio.on('leave')
def handle_leave(data):
    """Allow users to leave specific chat rooms"""
    room = data.get('room')
    if room:
        leave_room(room)
        print(f'Client {request.sid} left room: {room}')

@socketio.on('fetch_history')
def handle_fetch_history(data):
    """Fetch and send message history for a specific room"""
    room_id = data.get('room')
    if room_id:
        messages = get_message_history(room_id)
        emit('history_loaded', {
            'room': room_id,
            'messages': messages
        }, room=request.sid)
        print(f'Sent {len(messages)} messages for room {room_id}')

@socketio.on('send_message')
def handle_send_message(data):
    """
    Handle incoming messages from clients and send to specific room
    Expected data format: {'text': 'message text', 'sender': 'user@email.com', 'receiver': 'user2@email.com', 'room': 'room_id'}
    """
    message_text = data.get('text', '')
    sender = data.get('sender', 'Anonymous')
    receiver = data.get('receiver', '')
    room = data.get('room', None)
    timestamp = data.get('timestamp', datetime.now().strftime('%I:%M %p'))
    
    if not message_text or not room:
        emit('error', {'message': 'Message text and room are required'}, room=request.sid)
        return
    
    # Save message to database
    save_message(sender, receiver, message_text, timestamp)
    
    # Create message object to send
    message_data = {
        'text': message_text,
        'sender': sender,
        'receiver': receiver,
        'timestamp': timestamp,
        'sid': request.sid  # Include sender's socket ID to identify own messages
    }
    
    print(f"Sending message from {sender} to {receiver} in room {room}")
    
    # Send to specific room only (both users in the private chat)
    emit('receive_message', message_data, room=room, include_self=True)

@socketio.on('typing')
def handle_typing(data):
    """Handle typing indicator"""
    sender = data.get('sender', '')
    receiver = data.get('receiver', '')
    status = data.get('status', False)
    room = data.get('room', '')
    
    if not room:
        return
    
    print(f"Typing indicator: {sender} -> {receiver}, status: {status}")
    
    # Forward typing status to the receiver only
    # We need to get the receiver's socket ID
    receiver_sid = online_users.get(receiver)
    if receiver_sid:
        emit('typing_update', {
            'sender': sender,
            'status': status
        }, room=receiver_sid)

@socketio.on('get_online_users')
def handle_get_online_users():
    """Send list of currently online users"""
    emit('online_users_list', {
        'users': list(online_users.keys())
    }, room=request.sid)

@app.route('/api/messages', methods=['POST'])
def receive_message():
    """Legacy REST endpoint for messages (kept for backward compatibility)"""
    data = request.json
    print(f"Received message via REST API: {data}")
    return jsonify({"status": "success", "message": "Message received"}), 200

if __name__ == '__main__':
    # Use socketio.run instead of app.run for WebSocket support
    socketio.run(app, host='localhost', port=5000, debug=True, allow_unsafe_werkzeug=True)