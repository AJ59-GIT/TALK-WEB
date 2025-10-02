// Initialize Socket.IO connection
const socket = io('http://localhost:5000');

// Store current user email and active chat info
let currentUserEmail = '';
let currentChatUser = '';
let currentChatUsername = '';
let currentRoom = '';
let typingTimeout = null;
let searchTimeout = null;

// Socket.IO event listeners
socket.on('connect', () => {
  console.log('Connected to WebSocket server');
  console.log('Socket ID:', socket.id);
  
  // Notify server of user login if we have the email
  if (currentUserEmail) {
    socket.emit('user_login', { email: currentUserEmail });
  }
  
  // Request online users list
  socket.emit('get_online_users');
});

socket.on('disconnect', () => {
  console.log('Disconnected from WebSocket server');
});

socket.on('connection_response', (data) => {
  console.log('Server response:', data.message);
});

socket.on('room_joined', (data) => {
  console.log('Joined room:', data.room);
  currentRoom = data.room;
});

socket.on('history_loaded', (data) => {
  console.log('History loaded:', data.messages.length, 'messages');
  const messagesContainer = document.getElementById('messages');
  messagesContainer.innerHTML = ''; // Clear existing messages
  
  // Display all historical messages
  data.messages.forEach(msg => {
    const messageElement = document.createElement('div');
    const isOwnMessage = msg.sender === currentUserEmail;
    
    messageElement.classList.add('message');
    messageElement.classList.add(isOwnMessage ? 'sent' : 'received');
    
    messageElement.innerHTML = `
      <p>${msg.text}</p>
      <time>${msg.timestamp}</time>
    `;
    
    messagesContainer.appendChild(messageElement);
  });
  
  // Scroll to bottom
  messagesContainer.scrollTop = messagesContainer.scrollHeight;
});

socket.on('receive_message', (data) => {
  console.log('Received message:', data);
  
  // Only display if message is for current chat
  if (data.sender === currentChatUser || data.receiver === currentChatUser || 
      data.sender === currentUserEmail) {
    const messagesContainer = document.getElementById('messages');
    const messageElement = document.createElement('div');
    
    // Determine if this is our own message
    const isOwnMessage = data.sender === currentUserEmail;
    
    messageElement.classList.add('message');
    messageElement.classList.add(isOwnMessage ? 'sent' : 'received');
    
    messageElement.innerHTML = `
      <p>${data.text}</p>
      <time>${data.timestamp}</time>
    `;
    
    messagesContainer.appendChild(messageElement);
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
  }
});

socket.on('user_status_update', (data) => {
  console.log('User status update:', data);
  updateUserStatus(data.email, data.status);
});

socket.on('online_users_list', (data) => {
  console.log('Online users:', data.users);
  // Update all users' status based on who's online
  data.users.forEach(email => {
    updateUserStatus(email, 'online');
  });
});

socket.on('typing_update', (data) => {
  console.log('Typing update:', data);
  const typingIndicator = document.getElementById('typing-indicator');
  
  if (data.status && data.sender === currentChatUser) {
    // Show typing indicator
    if (typingIndicator) {
      typingIndicator.style.display = 'block';
      typingIndicator.textContent = `${data.sender.split('@')[0]} is typing...`;
    }
  } else {
    // Hide typing indicator
    if (typingIndicator) {
      typingIndicator.style.display = 'none';
    }
  }
});

socket.on('error', (data) => {
  console.error('Socket error:', data.message);
  alert('Error: ' + data.message);
});

function updateUserStatus(email, status) {
  // Find all user elements with this email and update status
  const userElements = document.querySelectorAll('.user');
  userElements.forEach(userEl => {
    const emailAttr = userEl.getAttribute('data-email');
    if (emailAttr === email) {
      const statusSpan = userEl.querySelector('.status');
      if (statusSpan) {
        statusSpan.className = 'status ' + status;
        statusSpan.textContent = status;
      }
    }
  });
}

function getRoomId(user1, user2) {
  // Generate consistent room ID by sorting emails
  const users = [user1, user2].sort();
  return `${users[0]}_${users[1]}`;
}

document.addEventListener('DOMContentLoaded', () => {
  const messageForm = document.getElementById('message-form');
  const messageInput = document.getElementById('message-input');
  const messagesContainer = document.getElementById('messages');
  const profileForm = document.getElementById('profile-form');
  const searchInput = document.getElementById('search-input');

  // Load current user profile to get email
  fetch('/profile')
    .then(response => response.json())
    .then(data => {
      currentUserEmail = data.email;
      console.log('Current user:', currentUserEmail);
      
      // Notify server of user login
      socket.emit('user_login', { email: currentUserEmail });
      
      // Request online users
      socket.emit('get_online_users');
      
      // Load contacts
      loadContacts();
    })
    .catch(err => console.error('Error loading profile:', err));

  // Search functionality
  if (searchInput) {
    searchInput.addEventListener('input', (e) => {
      const query = e.target.value.trim();
      
      // Clear previous timeout
      if (searchTimeout) {
        clearTimeout(searchTimeout);
      }
      
      // Debounce search by 500ms
      searchTimeout = setTimeout(() => {
        if (query.length > 0) {
          searchUsers(query);
        } else {
          document.getElementById('search-results').innerHTML = '';
        }
      }, 500);
    });
  }

  // Tab switching
  const navLinks = document.querySelectorAll('nav ul li a');
  navLinks.forEach(link => {
    link.addEventListener('click', (e) => {
      e.preventDefault();
      const tab = link.getAttribute('data-tab');
      switchTab(tab);
    });
  });

  // Add typing indicator listener
  messageInput.addEventListener('input', () => {
    if (currentChatUser && currentRoom) {
      // Clear previous timeout
      if (typingTimeout) {
        clearTimeout(typingTimeout);
      }
      
      // Emit typing status
      socket.emit('typing', {
        sender: currentUserEmail,
        receiver: currentChatUser,
        room: currentRoom,
        status: true
      });
      
      // Set timeout to stop typing indicator after 2 seconds of inactivity
      typingTimeout = setTimeout(() => {
        socket.emit('typing', {
          sender: currentUserEmail,
          receiver: currentChatUser,
          room: currentRoom,
          status: false
        });
      }, 2000);
    }
  });

  // Stop typing indicator when focus is lost
  messageInput.addEventListener('blur', () => {
    if (currentChatUser && currentRoom) {
      socket.emit('typing', {
        sender: currentUserEmail,
        receiver: currentChatUser,
        room: currentRoom,
        status: false
      });
    }
  });

  messageForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const messageText = messageInput.value.trim();
    if (messageText === '' || !currentChatUser || !currentRoom) return;

    // Get current timestamp
    const now = new Date();
    const timestamp = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    // Send message via WebSocket to specific room
    socket.emit('send_message', {
      text: messageText,
      sender: currentUserEmail,
      receiver: currentChatUser,
      room: currentRoom,
      timestamp: timestamp
    });

    // Clear input
    messageInput.value = '';
    
    // Stop typing indicator
    socket.emit('typing', {
      sender: currentUserEmail,
      receiver: currentChatUser,
      room: currentRoom,
      status: false
    });
  });

  if (profileForm) {
    profileForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const email = document.getElementById('profile-email').value;
      const password = document.getElementById('profile-password').value;
      updateProfile(email, password);
    });
  }

  // Make selectChat function globally accessible
  window.selectChat = selectChat;
  window.addContact = addContact;
  window.removeContact = removeContact;
});

function loadContacts() {
  fetch('/api/contacts')
    .then(response => response.json())
    .then(data => {
      displayContacts(data.contacts);
    })
    .catch(err => console.error('Error loading contacts:', err));
}

function displayContacts(contacts) {
  const sidebar = document.getElementById('contacts-sidebar');
  const contactsList = document.getElementById('contacts-user-list');
  
  if (contacts.length === 0) {
    sidebar.innerHTML = '<div style="padding: 20px; text-align: center; color: #999;"><p>No contacts yet. Search for users to add!</p></div>';
    contactsList.innerHTML = '<div style="padding: 20px; text-align: center; color: #999;"><p>No contacts yet</p></div>';
    return;
  }
  
  // Update sidebar
  sidebar.innerHTML = '';
  contacts.forEach((contact, index) => {
    const userDiv = document.createElement('div');
    userDiv.className = 'user' + (index === 0 ? ' active' : '');
    userDiv.setAttribute('data-email', contact.email);
    userDiv.onclick = function() { selectChat(this); };
    
    userDiv.innerHTML = `
      <img src="attached_assets/generated_images/Female_user_avatar_b6938c2b.png" alt="${contact.username}" />
      <span>${contact.username}</span>
      <span class="status ${contact.status}">${contact.status}</span>
    `;
    
    sidebar.appendChild(userDiv);
  });
  
  // Update contacts list in contacts tab
  contactsList.innerHTML = '';
  contacts.forEach(contact => {
    const userDiv = document.createElement('div');
    userDiv.className = 'user';
    userDiv.setAttribute('data-email', contact.email);
    userDiv.style.position = 'relative';
    
    userDiv.innerHTML = `
      <img src="attached_assets/generated_images/Female_user_avatar_b6938c2b.png" alt="${contact.username}" />
      <span>${contact.username}</span>
      <span class="status ${contact.status}">${contact.status}</span>
      <button 
        onclick="removeContact('${contact.email}')" 
        style="position: absolute; right: 10px; background: #dc3545; color: white; border: none; padding: 5px 10px; border-radius: 3px; cursor: pointer; font-size: 0.85em;"
        title="Remove contact"
      >Remove</button>
    `;
    
    contactsList.appendChild(userDiv);
  });
}

function searchUsers(query) {
  fetch(`/api/search_users?query=${encodeURIComponent(query)}`)
    .then(response => response.json())
    .then(data => {
      displaySearchResults(data.users);
    })
    .catch(err => console.error('Error searching users:', err));
}

function displaySearchResults(users) {
  const resultsDiv = document.getElementById('search-results');
  
  if (users.length === 0) {
    resultsDiv.innerHTML = '<p style="color: #999; padding: 10px;">No users found</p>';
    return;
  }
  
  resultsDiv.innerHTML = '<h3 style="margin-bottom: 10px;">Search Results</h3>';
  
  users.forEach(user => {
    const userDiv = document.createElement('div');
    userDiv.style.cssText = 'display: flex; align-items: center; justify-content: space-between; padding: 10px; border: 1px solid #ddd; border-radius: 5px; margin-bottom: 10px;';
    
    userDiv.innerHTML = `
      <div>
        <strong>${user.username}</strong>
        <br>
        <small style="color: #666;">${user.email}</small>
      </div>
      <button 
        onclick="addContact('${user.email}')" 
        style="background: #28a745; color: white; border: none; padding: 8px 15px; border-radius: 5px; cursor: pointer; font-size: 0.9em;"
      >Add Contact</button>
    `;
    
    resultsDiv.appendChild(userDiv);
  });
}

function addContact(email) {
  fetch('/api/contacts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ contact_email: email })
  })
  .then(response => response.json())
  .then(data => {
    if (data.message) {
      alert('Contact added successfully!');
      loadContacts();
      document.getElementById('search-input').value = '';
      document.getElementById('search-results').innerHTML = '';
    } else if (data.error) {
      alert('Error: ' + data.error);
    }
  })
  .catch(err => console.error('Error adding contact:', err));
}

function removeContact(email) {
  if (!confirm(`Are you sure you want to remove ${email} from your contacts?`)) {
    return;
  }
  
  fetch('/api/contacts', {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ contact_email: email })
  })
  .then(response => response.json())
  .then(data => {
    if (data.message) {
      alert('Contact removed successfully!');
      loadContacts();
    } else if (data.error) {
      alert('Error: ' + data.error);
    }
  })
  .catch(err => console.error('Error removing contact:', err));
}

function switchTab(tab) {
  // Hide all sections
  const sections = document.querySelectorAll('.chat-area');
  sections.forEach(section => {
    section.style.display = 'none';
  });

  // Show selected section
  const activeSection = document.getElementById(tab);
  if (activeSection) {
    activeSection.style.display = 'flex';
  }

  // Update nav active class
  const navLinks = document.querySelectorAll('nav ul li a');
  navLinks.forEach(link => {
    link.classList.remove('active');
  });
  const activeLink = document.querySelector(`nav ul li a[data-tab="${tab}"]`);
  if (activeLink) {
    activeLink.classList.add('active');
  }
}

function selectChat(userElement) {
  // Remove active class from all users
  const allUsers = document.querySelectorAll('.user-list .user');
  allUsers.forEach(user => {
    user.classList.remove('active');
  });
  
  // Add active class to selected user
  userElement.classList.add('active');
  
  // Get the user's info from the element
  const userName = userElement.querySelector('span:first-of-type').textContent;
  currentChatUser = userElement.getAttribute('data-email');
  currentChatUsername = userName;
  
  // Update the chat header with the selected user's name
  const chatHeader = document.querySelector('#chats .chat-header h2');
  if (chatHeader) {
    chatHeader.textContent = userName;
  }
  
  // Generate room ID for this conversation
  if (currentUserEmail && currentChatUser) {
    currentRoom = getRoomId(currentUserEmail, currentChatUser);
    
    // Join the room
    socket.emit('join', { room: currentRoom });
    
    // Fetch message history for this room
    socket.emit('fetch_history', { room: currentRoom });
  }
  
  // Make sure we're on the chats tab
  switchTab('chats');
}

function openProfile() {
  switchTab('profile');
  // Load current profile data
  fetch('/profile')
    .then(response => response.json())
    .then(data => {
      document.getElementById('profile-email').value = data.email;
      currentUserEmail = data.email;
    })
    .catch(err => console.error('Error loading profile:', err));
}

function updateProfile(email, password) {
  const data = { email };
  if (password) data.password = password;
  fetch('/profile', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data)
  })
  .then(response => response.json())
  .then(data => {
    alert('Profile updated successfully');
    currentUserEmail = email;
    
    // Update server with new email
    socket.emit('user_login', { email: currentUserEmail });
  })
  .catch(err => console.error('Error updating profile:', err));
}

function logout() {
  socket.disconnect();
  window.location.href = '/logout';
}