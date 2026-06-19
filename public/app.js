const panelInput = document.getElementById('panel-input');
const panelCode = document.getElementById('panel-code');
const panelSuccess = document.getElementById('panel-success');

const numberInput = document.getElementById('number');
const btnPair = document.getElementById('btn-pair');
const btnLabel = btnPair.querySelector('.btn-label');
const btnSpinner = btnPair.querySelector('.btn-spinner');
const errorMsg = document.getElementById('error-msg');

const codeText = document.getElementById('code-text');
const statusText = document.getElementById('status-text');
const pulseDot = document.getElementById('pulse-dot');
const copyCodeBtn = document.getElementById('copy-code');
const btnCancel = document.getElementById('btn-cancel');

const sessionStringBox = document.getElementById('session-string');
const copySessionBtn = document.getElementById('copy-session');
const btnNew = document.getElementById('btn-new');

let currentSessionId = null;
let pollHandle = null;

function showPanel(panel) {
  [panelInput, panelCode, panelSuccess].forEach(p => p.classList.add('hidden'));
  panel.classList.remove('hidden');
}

function setLoading(isLoading) {
  btnPair.disabled = isLoading;
  btnLabel.textContent = isLoading ? 'Connecting…' : 'Generate pairing code';
  btnSpinner.hidden = !isLoading;
}

function showError(msg) {
  errorMsg.textContent = msg;
  errorMsg.hidden = false;
}

function clearError() {
  errorMsg.hidden = true;
  errorMsg.textContent = '';
}

async function startPairing() {
  clearError();
  const raw = numberInput.value.trim();
  if (!raw) {
    showError('Enter a phone number first.');
    return;
  }

  setLoading(true);
  try {
    const res = await fetch('/api/pair', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ number: raw }),
    });
    const data = await res.json();

    if (!res.ok) {
      showError(data.error || 'Could not generate a pairing code.');
      setLoading(false);
      return;
    }

    currentSessionId = data.sessionId;
    codeText.textContent = formatCode(data.code);
    statusText.textContent = 'Waiting for device…';
    showPanel(panelCode);
    pollStatus();
  } catch (err) {
    showError('Network error. Try again.');
  } finally {
    setLoading(false);
  }
}

function formatCode(code) {
  if (!code) return '— — — — — — — —';
  return code.split('').join(' ');
}

function pollStatus() {
  clearInterval(pollHandle);
  pollHandle = setInterval(async () => {
    if (!currentSessionId) return;
    try {
      const res = await fetch(`/api/status/${currentSessionId}`);
      if (res.status === 404) {
        clearInterval(pollHandle);
        statusText.textContent = 'Code expired — start again';
        return;
      }
      const data = await res.json();

      if (data.status === 'connected') {
        clearInterval(pollHandle);
        sessionStringBox.value = data.sessionString;
        showPanel(panelSuccess);
      } else if (data.status === 'failed') {
        clearInterval(pollHandle);
        statusText.textContent = data.error || 'Pairing failed. Start again.';
        pulseDot.style.background = '#ff6b6b';
      }
    } catch (_) {
      // transient network hiccup, keep polling
    }
  }, 2500);
}

function resetToStart() {
  clearInterval(pollHandle);
  currentSessionId = null;
  numberInput.value = '';
  clearError();
  showPanel(panelInput);
}

async function cancelPairing() {
  clearInterval(pollHandle);
  if (currentSessionId) {
    fetch(`/api/cleanup/${currentSessionId}`, { method: 'POST' }).catch(() => {});
  }
  resetToStart();
}

btnPair.addEventListener('click', startPairing);
numberInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') startPairing(); });
btnCancel.addEventListener('click', cancelPairing);
btnNew.addEventListener('click', resetToStart);

copyCodeBtn.addEventListener('click', () => {
  const raw = codeText.textContent.replace(/\s+/g, '');
  navigator.clipboard.writeText(raw).then(() => {
    copyCodeBtn.textContent = 'Copied';
    setTimeout(() => (copyCodeBtn.textContent = 'Copy'), 1500);
  });
});

copySessionBtn.addEventListener('click', () => {
  navigator.clipboard.writeText(sessionStringBox.value).then(() => {
    copySessionBtn.textContent = 'Copied to clipboard';
    setTimeout(() => (copySessionBtn.textContent = 'Copy session string'), 1500);
  });
});
