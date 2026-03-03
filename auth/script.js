// Initialize Firebase with your config
const firebaseConfig = {
    apiKey: "AIzaSyBEY1V9m8UIkgWUKJIbdhUuQKCo2I4rztM",
    authDomain: "live-stream-7b16a.firebaseapp.com",
    databaseURL: "https://live-stream-7b16a-default-rtdb.firebaseio.com",
    projectId: "live-stream-7b16a",
    storageBucket: "live-stream-7b16a.firebasestorage.app",
    messagingSenderId: "13367877746",
    appId: "1:13367877746:web:7950e063fee3c01109a2eb"
};

firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const db = firebase.firestore();

// Check if user is already logged in
auth.onAuthStateChanged((user) => {
    if (user) {
        // User is logged in, redirect to host dashboard
        if (window.location.pathname.includes('login.html') ||
            window.location.pathname.includes('signup.html')) {
            window.location.href = '../host/index.html';
        }
    }
});

// Login functionality
if (window.location.pathname.includes('login.html')) {
    document.getElementById('loginForm').addEventListener('submit', async (e) => {
        e.preventDefault();

        const email = document.getElementById('email').value;
        const password = document.getElementById('password').value;
        const btn = document.getElementById('loginBtn');
        const btnText = document.getElementById('btnText');
        const spinner = document.getElementById('loadingSpinner');
        const errorDiv = document.getElementById('errorMessage');

        // Show loading state
        btn.disabled = true;
        btnText.style.display = 'none';
        spinner.style.display = 'inline-block';
        errorDiv.style.display = 'none';

        try {
            await auth.signInWithEmailAndPassword(email, password);
            // Redirect on success
            window.location.href = '../host/index.html';
        } catch (error) {
            // Show error
            errorDiv.textContent = error.message;
            errorDiv.style.display = 'block';

            // Reset button
            btn.disabled = false;
            btnText.style.display = 'inline';
            spinner.style.display = 'none';
        }
    });
}

// Signup functionality
if (window.location.pathname.includes('signup.html')) {
    const passwordInput = document.getElementById('password');
    const confirmInput = document.getElementById('confirmPassword');
    const strengthBar = document.getElementById('strengthBar');
    const strengthText = document.getElementById('strengthText');

    // Password strength checker
    passwordInput.addEventListener('input', () => {
        const password = passwordInput.value;
        let strength = 0;

        if (password.length >= 8) strength++;
        if (password.match(/[a-z]/)) strength++;
        if (password.match(/[A-Z]/)) strength++;
        if (password.match(/[0-9]/)) strength++;
        if (password.match(/[^a-zA-Z0-9]/)) strength++;

        strengthBar.className = 'strength-bar';
        if (strength <= 2) {
            strengthBar.classList.add('weak');
            strengthText.textContent = 'Weak password';
        } else if (strength <= 4) {
            strengthBar.classList.add('medium');
            strengthText.textContent = 'Medium password';
        } else {
            strengthBar.classList.add('strong');
            strengthText.textContent = 'Strong password';
        }
    });

    document.getElementById('signupForm').addEventListener('submit', async (e) => {
        e.preventDefault();

        const name = document.getElementById('name').value;
        const email = document.getElementById('email').value;
        const password = document.getElementById('password').value;
        const confirmPassword = document.getElementById('confirmPassword').value;
        const btn = document.getElementById('signupBtn');
        const btnText = document.getElementById('btnText');
        const spinner = document.getElementById('loadingSpinner');
        const errorDiv = document.getElementById('errorMessage');

        // Validate passwords match
        if (password !== confirmPassword) {
            errorDiv.textContent = 'Passwords do not match';
            errorDiv.style.display = 'block';
            return;
        }

        // Show loading state
        btn.disabled = true;
        btnText.style.display = 'none';
        spinner.style.display = 'inline-block';
        errorDiv.style.display = 'none';

        try {
            // Create user
            const userCredential = await auth.createUserWithEmailAndPassword(email, password);

            // Update profile with name
            await userCredential.user.updateProfile({
                displayName: name
            });

            // Save user to Firestore
            await db.collection('users').doc(userCredential.user.uid).set({
                name: name,
                email: email,
                createdAt: firebase.firestore.FieldValue.serverTimestamp()
            });

            // Redirect on success
            window.location.href = '../host/index.html';
        } catch (error) {
            // Show error
            errorDiv.textContent = error.message;
            errorDiv.style.display = 'block';

            // Reset button
            btn.disabled = false;
            btnText.style.display = 'inline';
            spinner.style.display = 'none';
        }
    });
}