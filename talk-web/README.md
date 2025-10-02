# TALK-WEB Project

## Overview
TALK-WEB is a futuristic-themed secure messaging web application built with a simple stack:
- Frontend: HTML, CSS, JavaScript
- Backend: Python Flask server

The UI features a baggie and white color scheme with modern styling and branding.

---

## Prerequisites
- Python 3.7 or higher installed on your system
- `pip` package manager for Python
- A modern web browser (Chrome, Firefox, Edge, etc.)

---

## Setup Instructions

1. **Clone or download the project files**

2. **Navigate to the project directory**

```bash
cd talk-web
```

3. **Create and activate a Python virtual environment (recommended)**

On Windows:
```bash
python -m venv venv
venv\Scripts\activate
```

On macOS/Linux:
```bash
python3 -m venv venv
source venv/bin/activate
```

4. **Install required Python packages**

```bash
pip install Flask werkzeug
```

---

## Running the Project

1. **Start the backend Flask server**

```bash
python server.py
```

This will start the server on `http://localhost:5000`.

2. **Open the frontend**

Open your web browser and navigate to:

```
http://localhost:5000
```

You should see the TALK-WEB chat interface.

---

## Features

- User registration and login system with email and password
- Session-based authentication
- Chat interface with user list and message area
- Futuristic UI with baggie and white color scheme
- Backend API to receive messages (currently logs messages to console)
- Static asset serving for CSS, JS, and images
- Logout functionality

---

## Development Notes

- Frontend files: `index.html`, `styles.css`, `app.js`
- Backend server: `server.py` (Flask)
- Static assets are served by the Flask server
- To stop the server, press `Ctrl+C` in the terminal

---

## Testing

- The backend API endpoint `/api/messages` accepts POST requests with JSON payloads.
- Example test using curl or PowerShell:

```bash
curl -X POST http://localhost:5000/api/messages -H "Content-Type: application/json" -d "{\"text\":\"Hello from test\"}"
```

---

## Future Improvements

- Add real-time messaging with WebSocket support
- Implement user authentication and session management
- Enhance UI responsiveness and accessibility

---

## License

MIT License

---

Thank you for using TALK-WEB!
