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
let currentStreamId = null;
let localStream = null;
let peerConnections = new Map(); // viewerId -> RTCPeerConnection
let socket = null;

// DOM Elements
const userNameSpan = document.getElementById('userName');
const logoutBtn = document.getElementById('logoutBtn');
const startPreviewBtn = document.getElementById('startPreviewBtn');
const goLiveBtn = document.getElementById('goLiveBtn');
const endStreamBtn = document.getElementById('endStreamBtn');
const previewVideo = document.getElementById('previewVideo');
const streamTitle = document.getElementById('streamTitle');
const streamDescription = document.getElementById('streamDescription');
const streamInfo = document.getElementById('streamInfo');
const rtmpUrl = document.getElementById('rtmpUrl');
const streamKey = document.getElementById('streamKey');
const viewerCount = document.getElementById('viewerCount');
const chatMessages = document.getElementById('chatMessages');
const chatInput = document.getElementById('chatInput');
const sendMessageBtn = document.getElementById('sendMessageBtn');

// Auth
auth.onAuthStateChanged((user) => {
    if (user) {
        currentUser = user;
        userNameSpan.textContent = user.displayName || user.email || 'Host';
        connectSocket();
    } else {
        window.location.href = '../auth/login.html';
    }
});

// Connect to signaling server
function connectSocket() {
    socket = io('http://localhost:3000');

    socket.on('connect', () => {
        console.log('✅ Connected to signaling server');
    });

    // When a viewer joins, create a peer connection for them
    socket.on('viewer-joined', async (data) => {
        console.log('👤 Viewer joined:', data.viewerId);
        await createPeerConnection(data.viewerId);
        viewerCount.textContent = data.count;
    });

    socket.on('viewer-left', (data) => {
        console.log('👤 Viewer left');
        viewerCount.textContent = data.count;
    });

    socket.on('viewer-count', (count) => {
        viewerCount.textContent = count;
    });

    // Handle WebRTC signaling from viewer
    socket.on('answer', async (data) => {
        console.log('📞 Received answer from:', data.from);
        const pc = peerConnections.get(data.from);
        if (pc) {
            try {
                await pc.setRemoteDescription(new RTCSessionDescription(data.answer));
                console.log('✅ Remote description set');
            } catch (err) {
                console.error('Error setting remote description:', err);
            }
        }
    });

    socket.on('ice-candidate', async (data) => {
        console.log('❄️ Received ICE candidate from:', data.from);
        const pc = peerConnections.get(data.from);
        if (pc) {
            try {
                await pc.addIceCandidate(new RTCIceCandidate(data.candidate));
            } catch (err) {
                console.error('Error adding ICE candidate:', err);
            }
        }
    });

    socket.on('new-message', (message) => {
        addMessageToChat(message);
    });

    socket.on('stream-ended', () => {
        alert('Stream ended');
        resetUI();
    });
}

// Start camera preview
startPreviewBtn.addEventListener('click', async () => {
    try {
        // Get user media
        localStream = await navigator.mediaDevices.getUserMedia({
            video: {
                width: { ideal: 1280 },
                height: { ideal: 720 }
            },
            audio: true
        });

        // Show preview
        previewVideo.srcObject = localStream;
        await previewVideo.play();

        startPreviewBtn.disabled = true;
        goLiveBtn.disabled = false;

        console.log('✅ Preview started');
    } catch (error) {
        console.error('Camera error:', error);
        alert('Please allow camera and microphone access');
    }
});

// Go Live
goLiveBtn.addEventListener('click', async () => {
    const title = streamTitle.value.trim();
    if (!title) {
        alert('Please enter a stream title');
        return;
    }

    try {
        goLiveBtn.disabled = true;
        goLiveBtn.textContent = 'Starting...';

        // Generate unique stream ID
        const streamId = Math.random().toString(36).substring(2, 15);
        currentStreamId = streamId;

        // Get user name safely
        const userName = currentUser?.displayName || currentUser?.email || 'Host';

        // Create stream in Firebase
        await db.collection('streams').doc(streamId).set({
            title: title,
            description: streamDescription.value || '',
            streamerName: userName,
            status: 'live',
            viewerCount: 0,
            createdAt: firebase.firestore.FieldValue.serverTimestamp()
        });

        // Display RTMP info (for OBS alternative)
        rtmpUrl.textContent = 'rtmp://localhost/live';
        streamKey.textContent = streamId;

        // Notify server via socket
        socket.emit('host-start', {
            streamId: streamId,
            title: title,
            description: streamDescription.value || '',
            userName: userName
        });

        // Update UI
        streamInfo.style.display = 'block';
        goLiveBtn.disabled = true;
        endStreamBtn.disabled = false;
        chatInput.disabled = false;
        sendMessageBtn.disabled = false;

        console.log('🔴 LIVE now! Stream ID:', streamId);

    } catch (error) {
        console.error('Error going live:', error);
        alert('Failed to start stream: ' + error.message);
        goLiveBtn.disabled = false;
        goLiveBtn.textContent = '🔴 Go Live';
    }
});

// Create peer connection for a viewer
async function createPeerConnection(viewerId) {
    console.log('🔌 Creating peer connection for viewer:', viewerId);

    const pc = new RTCPeerConnection({
        iceServers: [
            { urls: 'stun:stun.l.google.com:19302' },
            { urls: 'stun:stun1.l.google.com:19302' },
            { urls: 'stun:stun2.l.google.com:19302' }
        ]
    });

    // Add all local tracks to the connection
    if (localStream) {
        localStream.getTracks().forEach(track => {
            pc.addTrack(track, localStream);
            console.log('📹 Added track:', track.kind);
        });
    }

    // Handle ICE candidates
    pc.onicecandidate = (event) => {
        if (event.candidate) {
            console.log('❄️ Sending ICE candidate to:', viewerId);
            socket.emit('ice-candidate', {
                streamId: currentStreamId,
                candidate: event.candidate,
                to: viewerId
            });
        }
    };

    // Log connection state changes
    pc.onconnectionstatechange = () => {
        console.log('🔌 Connection state:', pc.connectionState);
        if (pc.connectionState === 'disconnected' || pc.connectionState === 'failed') {
            peerConnections.delete(viewerId);
        }
    };

    // Create and send offer
    try {
        const offer = await pc.createOffer({
            offerToReceiveAudio: false,
            offerToReceiveVideo: false
        });

        await pc.setLocalDescription(offer);
        console.log('📞 Sending offer to:', viewerId);

        socket.emit('offer', {
            streamId: currentStreamId,
            offer: pc.localDescription,
            to: viewerId
        });

        peerConnections.set(viewerId, pc);

    } catch (err) {
        console.error('Error creating offer:', err);
    }
}

// End stream
endStreamBtn.addEventListener('click', () => {
    // Close all peer connections
    peerConnections.forEach((pc) => {
        pc.close();
    });
    peerConnections.clear();

    // Notify server
    socket.emit('host-stop', currentStreamId);

    // Update Firebase
    db.collection('streams').doc(currentStreamId).update({
        status: 'ended'
    }).catch(err => console.log('Error updating stream:', err));

    resetUI();
});

// Reset UI after stream ends
function resetUI() {
    // Stop local stream
    if (localStream) {
        localStream.getTracks().forEach(track => track.stop());
        localStream = null;
    }

    // Reset UI
    streamInfo.style.display = 'none';
    goLiveBtn.disabled = false;
    goLiveBtn.textContent = '🔴 Go Live';
    endStreamBtn.disabled = true;
    startPreviewBtn.disabled = false;
    chatInput.disabled = true;
    sendMessageBtn.disabled = true;

    previewVideo.srcObject = null;
    currentStreamId = null;
}

// Chat functionality
sendMessageBtn.addEventListener('click', sendMessage);
chatInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') sendMessage();
});

function sendMessage() {
    const message = chatInput.value.trim();
    if (!message || !currentStreamId || !socket) return;

    const userName = currentUser?.displayName || currentUser?.email || 'Host';

    socket.emit('send-message', {
        streamId: currentStreamId,
        message: message,
        userName: userName
    });

    chatInput.value = '';
}

function addMessageToChat(message) {
    const div = document.createElement('div');
    div.className = 'message';
    div.innerHTML = `
        <strong>${message.userName || 'Anonymous'}:</strong> ${message.message}
    `;
    chatMessages.appendChild(div);
    chatMessages.scrollTop = chatMessages.scrollHeight;
}

// Copy to clipboard function
window.copyToClipboard = function (elementId) {
    const element = document.getElementById(elementId);
    const text = element.textContent;

    navigator.clipboard.writeText(text).then(() => {
        alert('✅ Copied to clipboard!');
    }).catch(err => {
        console.error('Failed to copy:', err);
        alert('❌ Failed to copy');
    });
};

// Logout
logoutBtn.addEventListener('click', async () => {
    if (localStream) {
        localStream.getTracks().forEach(track => track.stop());
    }
    if (socket) {
        socket.disconnect();
    }
    await auth.signOut();
    window.location.href = '../index.html';
});