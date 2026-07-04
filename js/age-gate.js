// Age & research-use verification gate.
// Shows once per browser SESSION (sessionStorage, not localStorage) —
// reappears every time the browser is closed and reopened, but not on
// every internal page click within the same visit.

(function () {
  if (sessionStorage.getItem('aciona_gate_accepted') === 'true') return;

  var overlay = document.createElement('div');
  overlay.id = 'age-gate-overlay';
  overlay.innerHTML =
    '<div class="age-gate-panel">' +
      '<div class="brand" style="justify-content:center; margin-bottom:18px;"><span class="brand-mark"></span> Aciona</div>' +
      '<h2>Age &amp; Research Use Verification</h2>' +
      '<p>Before entering, please confirm the following:</p>' +
      '<label class="age-gate-check">' +
        '<input type="checkbox" id="gate-age">' +
        '<span>I confirm I am 18 years of age or older</span>' +
      '</label>' +
      '<label class="age-gate-check">' +
        '<input type="checkbox" id="gate-research">' +
        '<span>I confirm I will only use these products for laboratory research purposes, and not for human or animal consumption</span>' +
      '</label>' +
      '<label class="age-gate-check">' +
        '<input type="checkbox" id="gate-terms">' +
        '<span>I have read and agree to Aciona\'s <a href="terms.html" target="_blank" rel="noopener" onclick="event.stopPropagation()">Terms of Service</a> and <a href="privacy.html" target="_blank" rel="noopener" onclick="event.stopPropagation()">Privacy Policy</a>, and accept all associated liability</span>' +
      '</label>' +
      '<div class="age-gate-actions">' +
        '<button id="gate-enter" class="btn btn-primary" disabled>Enter Site</button>' +
        '<a href="#" id="gate-exit" class="age-gate-exit">I do not agree</a>' +
      '</div>' +
    '</div>';

  document.body.appendChild(overlay);
  document.body.style.overflow = 'hidden';

  var ageBox = document.getElementById('gate-age');
  var researchBox = document.getElementById('gate-research');
  var termsBox = document.getElementById('gate-terms');
  var enterBtn = document.getElementById('gate-enter');

  function updateButton() {
    enterBtn.disabled = !(ageBox.checked && researchBox.checked && termsBox.checked);
  }
  ageBox.addEventListener('change', updateButton);
  researchBox.addEventListener('change', updateButton);
  termsBox.addEventListener('change', updateButton);

  enterBtn.addEventListener('click', function () {
    sessionStorage.setItem('aciona_gate_accepted', 'true');
    overlay.remove();
    document.body.style.overflow = '';
  });

  document.getElementById('gate-exit').addEventListener('click', function (e) {
    e.preventDefault();
    window.location.href = 'https://www.google.com';
  });
})();
