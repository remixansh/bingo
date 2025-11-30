// Initialize Socket.IO
const socket = io('http://localhost:5000');

// Game State
let myBoard = new Array(25).fill(null);
let myTurn = false;
let mySid = null;
let currentNumberToPlace = 1;
let currentRoomId = null;

// --- DOM Elements ---
const loginScreen = document.getElementById('login-screen');
const setupScreen = document.getElementById('setup-screen');
const gameScreen = document.getElementById('game-screen');
const statusMsg = document.getElementById('status-msg');
const setupGrid = document.getElementById('setup-grid');
const gameGrid = document.getElementById('game-grid');
const readyBtn = document.getElementById('ready-btn');
const turnIndicator = document.getElementById('turn-indicator');
const myNameDisplay = document.getElementById('my-name');
const roomDisplaySetup = document.getElementById('room-display-setup');
const roomDisplayGame = document.getElementById('room-display-game');

// Login Elements
const initialButtons = document.getElementById('initial-buttons');
const joinInputs = document.getElementById('join-inputs');

// Game Over Elements
const gameOverModal = document.getElementById('game-over-modal');
const resultTitle = document.getElementById('result-title');
const resultMsg = document.getElementById('result-msg');
const playAgainBtn = document.getElementById('play-again-btn');
const rematchStatus = document.getElementById('rematch-status');

// --- Event Listeners ---
document.getElementById('create-btn').addEventListener('click', createGame);
document.getElementById('show-join-btn').addEventListener('click', showJoinInputs);
document.getElementById('confirm-join-btn').addEventListener('click', joinExistingGame);
document.getElementById('back-btn').addEventListener('click', hideJoinInputs);

document.getElementById('randomize-btn').addEventListener('click', randomizeBoard);
readyBtn.addEventListener('click', submitBoard);
playAgainBtn.addEventListener('click', requestRematch);

// --- Socket Listeners ---

socket.on('connect', () => {
    mySid = socket.id;
    console.log("Connected to server:", mySid);
});

socket.on('error', (data) => {
    alert(data.message);
    location.reload();
});

socket.on('opponent_left', () => {
    alert("Your opponent has left the game. The room will be closed.");
    location.reload();
});

socket.on('player_joined', (data) => {
    if (setupScreen.classList.contains('hidden') && loginScreen.classList.contains('hidden')) {
        statusMsg.innerText = `Players: ${data.count}/2`;
    }
    console.log(`Players in room: ${data.players.join(', ')}`);
});

socket.on('game_start', (data) => {
    setupScreen.classList.add('hidden');
    gameScreen.classList.remove('hidden');
    
    // Reset Game Over UI
    gameOverModal.classList.add('hidden');
    playAgainBtn.disabled = false;
    playAgainBtn.classList.remove('opacity-50', 'cursor-not-allowed');
    rematchStatus.classList.add('hidden');
    
    createGameGrid();
    updateTurn(data.turn);
});

socket.on('move_made', (data) => {
    markNumberOnBoard(data.number);
    checkAndDrawLines(); 
    
    if (data.gameOver) {
        handleGameOver(data.winner);
    } else {
        updateTurn(data.nextTurn);
        statusMsg.innerText = `LAST NUMBER: ${data.number}`;
    }
});

socket.on('reset_game', () => {
    // Reset local state
    myBoard = new Array(25).fill(null);
    currentNumberToPlace = 1;
    
    // Reset UI to Setup Screen
    gameScreen.classList.add('hidden');
    setupScreen.classList.remove('hidden');
    
    // Reset UI Elements
    initSetupGrid();
    readyBtn.disabled = true;
    readyBtn.innerText = "Ready to Play";
    gameOverModal.classList.add('hidden'); 
});

socket.on('rematch_status', (data) => {
    // If desired, we can show "1/2 Players Ready" logic here
});

// --- UI Logic Functions ---

function createGame() {
    const name = document.getElementById('username').value;
    if(!name) return alert("Please enter your name first");

    const roomId = Math.floor(Math.random() * 9999) + 1;
    startGameFlow(name, roomId);
}

function showJoinInputs() {
    initialButtons.classList.add('hidden');
    joinInputs.classList.remove('hidden');
}

function hideJoinInputs() {
    joinInputs.classList.add('hidden');
    initialButtons.classList.remove('hidden');
}

function joinExistingGame() {
    const name = document.getElementById('username').value;
    const roomId = document.getElementById('roomId').value;
    
    if(!name || !roomId) return alert("Please enter both Name and Room ID");
    
    startGameFlow(name, roomId);
}

function startGameFlow(name, roomId) {
    currentRoomId = roomId;
    
    socket.emit('join_room', { name, roomId: roomId.toString() });
    
    loginScreen.classList.add('hidden');
    setupScreen.classList.remove('hidden');
    
    myNameDisplay.innerText = name;
    roomDisplaySetup.innerText = roomId;
    roomDisplayGame.innerText = roomId;
    
    initSetupGrid();
}

function initSetupGrid() {
    setupGrid.innerHTML = '';
    currentNumberToPlace = 1;
    myBoard = new Array(25).fill(null);
    
    for(let i=0; i<25; i++) {
        const cell = document.createElement('div');
        cell.className = "bingo-cell";
        
        cell.onclick = () => {
            if (myBoard[i] !== null) return; 
            if (currentNumberToPlace > 25) return;

            myBoard[i] = currentNumberToPlace;
            cell.innerText = currentNumberToPlace;
            cell.classList.add('selected'); // Updated class name for design
            currentNumberToPlace++;
            
            if (currentNumberToPlace > 25) {
                readyBtn.disabled = false;
            }
        };
        setupGrid.appendChild(cell);
    }
}

function randomizeBoard() {
    let nums = [];
    for(let i=1; i<=25; i++) nums.push(i);
    
    // Fisher-Yates Shuffle
    for (let i = nums.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [nums[i], nums[j]] = [nums[j], nums[i]];
    }
    
    myBoard = nums;
    
    const cells = document.querySelectorAll('#setup-grid .bingo-cell');
    if(cells.length === 0) initSetupGrid(); 

    const currentCells = document.querySelectorAll('#setup-grid .bingo-cell');
    currentCells.forEach((cell, idx) => {
        cell.innerText = myBoard[idx];
        cell.classList.add('selected');
    });
    
    readyBtn.disabled = false;
    currentNumberToPlace = 26; 
}

function submitBoard() {
    socket.emit('submit_board', { roomId: currentRoomId.toString(), board: myBoard });
    
    readyBtn.innerText = "Waiting...";
    readyBtn.disabled = true;
}

function createGameGrid() {
    gameGrid.innerHTML = '';
    // Clear old lines
    const oldLines = gameGrid.querySelectorAll('.win-line');
    oldLines.forEach(l => l.remove());
    
    myBoard.forEach((num) => {
        const cell = document.createElement('div');
        cell.className = "bingo-cell";
        cell.innerText = num;
        cell.dataset.number = num;
        
        cell.onclick = () => {
            if (!myTurn) return;
            if (cell.classList.contains('marked')) return;
            
            socket.emit('make_move', { roomId: currentRoomId.toString(), number: num });
        };
        gameGrid.appendChild(cell);
    });
}

function updateTurn(turnSid) {
    myTurn = (turnSid === socket.id);
    
    if (myTurn) {
        turnIndicator.innerText = "YOUR TURN";
        turnIndicator.className = "px-4 py-1.5 rounded-full font-bold text-xs uppercase tracking-wide bg-green-500 text-white animate-pulse shadow-lg shadow-green-500/50 transition-colors duration-300";
        gameGrid.classList.remove('opacity-50', 'pointer-events-none');
    } else {
        turnIndicator.innerText = "OPPONENT'S TURN";
        turnIndicator.className = "px-4 py-1.5 rounded-full font-bold text-xs uppercase tracking-wide bg-slate-800 text-slate-400 border border-slate-700 transition-colors duration-300";
        gameGrid.classList.add('opacity-50', 'pointer-events-none');
    }
}

function markNumberOnBoard(num) {
    const cells = document.querySelectorAll('#game-grid .bingo-cell');
    cells.forEach(cell => {
        if (parseInt(cell.innerText) === num) {
            cell.classList.add('marked');
        }
    });
}

function checkAndDrawLines() {
    const cells = Array.from(document.querySelectorAll('#game-grid .bingo-cell'));
    if(cells.length === 0) return;

    const isMarked = (index) => cells[index].classList.contains('marked');
    const grid = document.getElementById('game-grid');

    const drawLine = (startIndex, endIndex) => {
        const lineId = `line-${startIndex}-${endIndex}`;
        if (document.getElementById(lineId)) return;

        const startCell = cells[startIndex];
        const endCell = cells[endIndex];
        
        // Geometry calculations for exact visual alignment
        const gridRect = grid.getBoundingClientRect();
        const startRect = startCell.getBoundingClientRect();
        const endRect = endCell.getBoundingClientRect();

        // Calculate centers relative to grid
        const x1 = startRect.left - gridRect.left + startRect.width / 2;
        const y1 = startRect.top - gridRect.top + startRect.height / 2;
        const x2 = endRect.left - gridRect.left + endRect.width / 2;
        const y2 = endRect.top - gridRect.top + endRect.height / 2;

        const length = Math.sqrt((x2 - x1) ** 2 + (y2 - y1) ** 2);
        const angle = Math.atan2(y2 - y1, x2 - x1) * (180 / Math.PI);

        const line = document.createElement('div');
        line.id = lineId;
        line.className = 'win-line'; 
        
        // Inline positioning to override generic CSS classes and handle Gaps/Padding dynamically
        Object.assign(line.style, {
            position: 'absolute',
            left: `${x1}px`,
            top: `${y1}px`,
            width: '0px', // Start at 0 for animation
            transform: `rotate(${angle}deg)`,
            transformOrigin: '0 50%',
            transition: 'width 0.5s cubic-bezier(0.4, 0, 0.2, 1)',
            zIndex: '20'
        });

        grid.appendChild(line);

        // Trigger animation
        requestAnimationFrame(() => {
            line.style.width = `${length}px`;
        });
    };

    // Check Rows
    for (let r = 0; r < 5; r++) {
        if ([0,1,2,3,4].every(c => isMarked(r * 5 + c))) drawLine(r * 5, r * 5 + 4);
    }
    // Check Columns
    for (let c = 0; c < 5; c++) {
        if ([0,1,2,3,4].every(r => isMarked(r * 5 + c))) drawLine(c, c + 20);
    }
    // Check Diagonals
    if ([0,1,2,3,4].every(i => isMarked(i * 6))) drawLine(0, 24);
    if ([0,1,2,3,4].every(i => isMarked(i * 4 + 4))) drawLine(4, 20);
}

function handleGameOver(winnerName) {
    const myName = document.getElementById('username').value;
    
    if (myName === winnerName) {
        resultTitle.innerText = "VICTORY";
        resultTitle.className = "text-5xl font-black mb-2 text-white drop-shadow-lg";
        resultMsg.innerText = "Excellent game!";
    } else {
        resultTitle.innerText = "DEFEAT";
        resultTitle.className = "text-5xl font-black mb-2 text-slate-500 drop-shadow-none";
        resultMsg.innerText = `${winnerName} won the game.`;
    }
    
    gameOverModal.classList.remove('hidden');
    
    // Disable board interaction
    const cells = document.querySelectorAll('#game-grid .bingo-cell');
    cells.forEach(c => c.classList.add('disabled'));
    
    playAgainBtn.innerText = "Play Again";
    playAgainBtn.classList.remove('opacity-50', 'cursor-not-allowed');
    playAgainBtn.disabled = false;
    rematchStatus.classList.add('hidden');
}

function requestRematch() {
    socket.emit('play_again', { roomId: currentRoomId.toString() });
    
    playAgainBtn.innerText = "Waiting...";
    playAgainBtn.disabled = true;
    playAgainBtn.classList.add('opacity-50', 'cursor-not-allowed');
    rematchStatus.classList.remove('hidden');
}