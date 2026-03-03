// Firebase Config
const firebaseConfig = {
    apiKey: "AIzaSyBEY1V9m8UIkgWUKJIbdhUuQKCo2I4rztM",
    authDomain: "live-stream-7b16a.firebaseapp.com",
    projectId: "live-stream-7b16a",
    storageBucket: "live-stream-7b16a.firebasestorage.app",
    messagingSenderId: "13367877746",
    appId: "1:13367877746:web:7950e063fee3c01109a2eb"
};

firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const db = firebase.firestore();

// Global variables
let currentUser = null;
let currentStream = null;
let remoteStream = null;
let peerConnection = null;
let socket = null;

// DOM Elements
const authButtons = document.getElementById('authButtons');
const userInfo = document.getElementById('userInfo');
const userNameSpan = document.getElementById('userName');
const logoutBtn = document.getElementById('logoutBtn');
const streamsView = document.getElementById('streamsView');
const playerView = document.getElementById('playerView');
const streamsGrid = document.getElementById('streamsGrid');
const searchInput = document.getElementById('searchInput');
const searchBtn = document.getElementById('searchBtn');
const backBtn = document.getElementById('backBtn');
const videoPlayer = document.getElementById('videoPlayer');
const streamTitle = document.getElementById('streamTitle');
const streamDescription = document.getElementById('streamDescription');
const streamerNameSpan = document.getElementById('streamerName');
const viewerCountSpan = document.getElementById('viewerCount');
const streamStatusSpan = document.getElementById('streamStatus');
const chatMessages = document.getElementById('chatMessages');
const chatInput = document.getElementById('chatInput');
const sendMessageBtn = document.getElementById('sendMessageBtn');

// Auth
auth.onAuthStateChanged((user) => {
    currentUser = user;
    updateUIForAuth();
    loadStreams();
});

function updateUIForAuth() {
    if (currentUser) {
        authButtons.style.display = 'none';
        userInfo.style.display = 'flex';
        userNameSpan.textContent = currentUser.displayName || currentUser.email || 'Viewer';

        if (currentStream) {
            chatInput.disabled = false;
            sendMessageBtn.disabled = false;
        }
    } else {
        authButtons.style.display = 'flex';
        userInfo.style.display = 'none';
        chatInput.disabled = true;
        sendMessageBtn.disabled = true;
    }
}

// Connect to signaling server
function connectSocket(streamId) {
    if (socket) {
        socket.disconnect();
    }

    socket = io('http://localhost:3000');

    socket.on('connect', () => {
        console.log('✅ Connected to signaling server');
        socket.emit('viewer-join', streamId);
    });

    // Handle offer from host
    socket.on('offer', async (data) => {
        console.log('📞 Received offer from host');
        await handleOffer(data);
    });

    // Handle ICE candidates
    socket.on('ice-candidate', async (data) => {
        console.log('❄️ Received ICE candidate');
        if (peerConnection) {
            try {
                await peerConnection.addIceCandidate(new RTCIceCandidate(data.candidate));
            } catch (err) {
                console.error('Error adding ICE candidate:', err);
            }
        }
    });

    // Viewer count updates
    socket.on('viewer-count', (count) => {
        viewerCountSpan.textContent = `${count} viewers`;
    });

    // New chat message
    socket.on('new-message', (message) => {
        addMessageToChat(message);
    });

    // Stream ended
    socket.on('stream-ended', () => {
        alert('Stream ended by host');
        backToStreams();
    });
}

// Handle WebRTC offer from host
async function handleOffer(data) {
    try {
        // Create peer connection
        peerConnection = new RTCPeerConnection({
            iceServers: [
                { urls: 'stun:stun.l.google.com:19302' },
                { urls: 'stun:stun1.l.google.com:19302' }
            ]
        });

        // When remote track arrives, show it
        peerConnection.ontrack = (event) => {
            console.log('📹 Received remote track:', event.track.kind);

            if (!remoteStream) {
                remoteStream = new MediaStream();
            }
            remoteStream.addTrack(event.track);

            videoPlayer.srcObject = remoteStream;
            videoPlayer.play()
                .then(() => console.log('✅ Video playing'))
                .catch(err => console.error('Play error:', err));
        };

        // Handle ICE candidates
        peerConnection.onicecandidate = (event) => {
            if (event.candidate) {
                socket.emit('ice-candidate', {
                    streamId: currentStream.id,
                    candidate: event.candidate,
                    to: data.from
                });
            }
        };

        // Log connection state
        peerConnection.onconnectionstatechange = () => {
            console.log('🔌 Connection state:', peerConnection.connectionState);
        };

        // Set remote description (offer from host)
        await peerConnection.setRemoteDescription(new RTCSessionDescription(data.offer));

        // Create answer
        const answer = await peerConnection.createAnswer();
        await peerConnection.setLocalDescription(answer);

        // Send answer back to host
        socket.emit('answer', {
            streamId: currentStream.id,
            answer: peerConnection.localDescription,
            to: data.from
        });

        console.log('📞 Sent answer to host');

    } catch (error) {
        console.error('Error handling offer:', error);
    }
}

// Load streams
async function loadStreams(searchTerm = '') {
    try {
        streamsGrid.innerHTML = '<div class="loading">Loading streams...</div>';

        const response = await fetch('http://localhost:3000/api/streams');
        const streams = await response.json();

        if (!Array.isArray(streams) || streams.length === 0) {
            streamsGrid.innerHTML = '<div class="no-streams">No live streams available</div>';
            return;
        }

        let html = '';
        streams.forEach(stream => {
            if (searchTerm && !stream.title?.toLowerCase().includes(searchTerm.toLowerCase())) {
                return;
            }

            html += `
                <div class="stream-card" onclick="selectStream('${stream.id}')">
                    <div class="stream-thumbnail">
                        <img src="https://via.placeholder.com/640x360?text=🔴+LIVE" alt="Stream">
                        <span class="live-indicator">🔴 LIVE</span>
                        <span class="viewer-count">👥 ${stream.viewerCount || 0}</span>
                    </div>
                    <div class="stream-info">
                        <h3>${stream.title || 'Untitled'}</h3>
                        <div>🎤 ${stream.streamerName || 'Anonymous'}</div>
                    </div>
                </div>
            `;
        });

        streamsGrid.innerHTML = html || '<div class="no-streams">No streams found</div>';

    } catch (error) {
        console.error('Error loading streams:', error);
        streamsGrid.innerHTML = '<div class="no-streams">Error loading streams</div>';
    }
}

// Select stream to watch
window.selectStream = async function (streamId) {
    try {
        console.log('📡 Selecting stream:', streamId);

        const response = await fetch(`http://localhost:3000/api/streams/${streamId}`);
        const stream = await response.json();

        if (!stream || stream.error) {
            throw new Error('Stream not found');
        }

        currentStream = stream;

        // Switch to player view
        streamsView.style.display = 'none';
        playerView.style.display = 'grid';

        // Update stream info
        streamTitle.textContent = stream.title || 'Untitled Stream';
        streamDescription.textContent = stream.description || 'No description';
        streamerNameSpan.textContent = `Host: ${stream.streamerName || 'Anonymous'}`;
        viewerCountSpan.textContent = `${stream.viewerCount || 0} viewers`;
        streamStatusSpan.textContent = '🔴 LIVE';

        // Connect to stream
        connectSocket(streamId);
        loadChatHistory(streamId);

        if (currentUser) {
            chatInput.disabled = false;
            sendMessageBtn.disabled = false;
        }

    } catch (error) {
        console.error('Error selecting stream:', error);
        alert('Error loading stream');
    }
};

// Load chat history
async function loadChatHistory(streamId) {
    try {
        const snapshot = await db.collection('chats')
            .where('streamId', '==', streamId)
            .orderBy('timestamp', 'asc')
            .limit(50)
            .get();

        chatMessages.innerHTML = '';

        if (snapshot.empty) {
            chatMessages.innerHTML = '<div class="no-messages">No messages yet</div>';
            return;
        }

        snapshot.forEach(doc => {
            const msg = doc.data();
            addMessageToChat({
                userName: msg.userName || 'Anonymous',
                message: msg.message
            });
        });

        chatMessages.scrollTop = chatMessages.scrollHeight;

    } catch (error) {
        console.error('Error loading chat:', error);
    }
}

// Send message
sendMessageBtn.addEventListener('click', sendMessage);
chatInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') sendMessage();
});

function sendMessage() {
    const message = chatInput.value.trim();
    if (!message || !currentUser || !currentStream || !socket) {
        if (!currentUser) alert('Please login to chat');
        return;
    }

    socket.emit('send-message', {
        streamId: currentStream.id,
        message: message,
        userName: currentUser.displayName || currentUser.email || 'Viewer',
        userId: currentUser.uid || 'anonymous'  // Add this line
    });

    chatInput.value = '';
}
function addMessageToChat(message) {
    if (chatMessages.innerHTML.includes('No messages')) {
        chatMessages.innerHTML = '';
    }

    const div = document.createElement('div');
    div.className = 'message';
    div.innerHTML = `
        <strong>${message.userName || 'Anonymous'}:</strong> ${message.message}
    `;
    chatMessages.appendChild(div);
    chatMessages.scrollTop = chatMessages.scrollHeight;
}

// Back to streams
backBtn.addEventListener('click', backToStreams);

function backToStreams() {
    // Close peer connection
    if (peerConnection) {
        peerConnection.close();
        peerConnection = null;
    }

    // Disconnect socket
    if (socket) {
        socket.disconnect();
        socket = null;
    }

    // Clear video
    videoPlayer.srcObject = null;

    // Switch view
    streamsView.style.display = 'block';
    playerView.style.display = 'none';

    currentStream = null;
    loadStreams();
}

// Search
searchBtn.addEventListener('click', () => {
    loadStreams(searchInput.value);
});

searchInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
        loadStreams(searchInput.value);
    }
});

// Logout
logoutBtn.addEventListener('click', async () => {
    if (socket) socket.disconnect();
    if (peerConnection) peerConnection.close();
    await auth.signOut();
    window.location.href = '../index.html';
});

// Initial load
loadStreams();

// Refresh streams every 30 seconds
setInterval(() => {
    if (streamsView.style.display !== 'none') {
        loadStreams(searchInput.value);
    }
}, 30000);