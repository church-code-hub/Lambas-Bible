(function () {
  const confirmationText =
    "You're about to enter Test Mode. This version contains new features and experimental updates that are still being tested. The main application remains unchanged. Do you want to continue?";

  function beginTestModeEntry() {
    if (!window.confirm(confirmationText)) return;

    if (window.LAMBAS_TEST_MODE_AVAILABLE !== true) {
      showUnavailableMessage();
      return;
    }

    const destination = new URL("./test-mode/", document.baseURI);
    if (destination.origin !== window.location.origin) {
      showUnavailableMessage();
      return;
    }
    window.location.assign(destination.href);
  }

  function showUnavailableMessage() {
    const status = document.getElementById("testModeEntryStatus");
    const message =
      "Test Mode is unavailable because its separate test deployment has not been configured.";
    if (status) {
      status.textContent = message;
      status.hidden = false;
    } else {
      window.alert(message);
    }
  }

  window.beginTestModeEntry = beginTestModeEntry;
  const button = document.getElementById("testModeEntryButton");
  if (button) button.addEventListener("click", beginTestModeEntry);
})();
