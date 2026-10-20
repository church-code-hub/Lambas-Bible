      function showToast(message, type = "error", duration = 5000) {
        const container = document.getElementById("toastContainer");
        const toast = document.createElement("div");
        toast.className = `toast ${type}`;
        toast.dataset.message = message;
        toast.innerText = translateText(message);
        toast.style.setProperty("--toast-out-delay", `${Math.max(0, duration - 250)}ms`);
        container.appendChild(toast);
        setTimeout(() => {
          toast.remove();
        }, duration);
      }

      function handleHomeNavigation() {
        if (activeApiRequestCount > 0 || isSyncingOfflineQueue) {
          showToast(translations[currentLang].requestInProgress, "info");
          return;
        }
        const viewId = currentActiveViewId;
        if (
          (viewId === "adminSettingsView" || viewId === "scheduleSettingsView") &&
          hasUnsavedSettingsChanges(viewId)
        ) {
          const dialog = document.getElementById("settingsExitDialog");
          if (!dialog.open) dialog.showModal();
          return;
        }
        showView("dashboardView");
      }

      function discardSettingsAndGoHome() {
        const dialog = document.getElementById("settingsExitDialog");
        if (dialog.open) dialog.close();
        discardSettingsChanges(currentActiveViewId);
        showView("dashboardView");
      }

      function continueSettingsEditing() {
        const dialog = document.getElementById("settingsExitDialog");
        if (dialog.open) dialog.close();
      }

      function showSearchLoader(container) {
        const wrapper = document.createElement("div");
        wrapper.className = "search-loading";
        wrapper.setAttribute("role", "status");
        wrapper.setAttribute("aria-live", "polite");
        const bars = document.createElement("div");
        bars.className = "loader-bars";
        bars.setAttribute("aria-hidden", "true");
        for (let index = 0; index < 5; index++) {
          bars.appendChild(document.createElement("span"));
        }
        const label = document.createElement("div");
        label.className = "search-loading-label";
        label.setAttribute("data-i18n", "searching");
        label.textContent = translations[currentLang].searching;
        wrapper.append(bars, label);
        container.replaceChildren(wrapper);
      }

      function showReportSkeleton(container, rows = 3, label = translations[currentLang].loadingReport) {
        const skeleton = document.createElement("div");
        skeleton.className = "report-loading";
        skeleton.setAttribute("role", "status");
        skeleton.setAttribute("aria-label", label);
        for (let index = 0; index < rows; index++) {
          const row = document.createElement("div");
          row.className = "report-skeleton-row";
          row.innerHTML = '<span></span><span></span>';
          skeleton.appendChild(row);
        }
        container.replaceChildren(skeleton);
      }

      function showView(viewId, pushHistory = true, bypassRequestLock = false) {
        if (
          !bypassRequestLock &&
          viewId !== currentActiveViewId &&
          (activeApiRequestCount > 0 || isSyncingOfflineQueue)
        ) {
          showToast(translations[currentLang].requestInProgress, "info");
          return false;
        }
        hideLoader();
        const viewChanged = currentActiveViewId !== viewId;
        if (currentActiveViewId && currentActiveViewId !== viewId)
          resetView(currentActiveViewId);
        if (viewId !== "currentAttendeesView" && currentAttendeesRefreshTimer) {
          window.clearInterval(currentAttendeesRefreshTimer);
          currentAttendeesRefreshTimer = 0;
        }
        if (viewId !== "dashboardView" && currentAttendeesWindowTimer) {
          window.clearTimeout(currentAttendeesWindowTimer);
          currentAttendeesWindowTimer = 0;
        }

        if (viewId !== "adminSettingsView") {
          const lockEl = document.getElementById("adminSettingsLock");
          const formEl = document.getElementById("adminSettingsForm");
          if (lockEl) lockEl.style.display = "block";
          if (formEl) formEl.style.display = "none";
          const pw = document.getElementById("adminGatePassword");
          if (pw) pw.value = "";
          resetPasswordVisibility("adminGatePassword");
          resetPasswordVisibility("cfgNewPassword");
        }
        if (viewId !== "scheduleSettingsView") {
          const lockEl = document.getElementById("scheduleSettingsLock");
          const formEl = document.getElementById("scheduleSettingsForm");
          if (lockEl) lockEl.style.display = "block";
          if (formEl) formEl.style.display = "none";
          const pw = document.getElementById("scheduleGatePassword");
          if (pw) pw.value = "";
          resetPasswordVisibility("scheduleGatePassword");
        }

        [
          "loginView",
          "dashboardView",
          "scanView",
          "searchView",
          "cardShareView",
          "cardPreviewView",
          "addView",
          "adminSettingsView",
          "appSettingsView",
          "scheduleSettingsView",
          "resultView",
          "attendanceReportView",
          "currentAttendeesView",
          "offlineQueueView",
        ].forEach((id) => {
          const el = document.getElementById(id);
          if (el) el.style.display = id === viewId ? "block" : "none";
        });
        const activeView = document.getElementById(viewId);
        if (activeView && currentActiveViewId !== viewId) {
          activeView.classList.remove("view-enter-forward", "view-enter-back");
          const enterClass = pushHistory
            ? "view-enter-forward"
            : "view-enter-back";
          window.requestAnimationFrame(() => {
            if (currentActiveViewId !== viewId || activeView.style.display === "none") return;
            activeView.classList.add(enterClass);
            window.setTimeout(() => {
              activeView.classList.remove("view-enter-forward", "view-enter-back");
            }, 200);
          });
        }

        const homeBtn = document.getElementById("homeBtn");
        const adminToolbarButton = document.getElementById("adminToolbarButton");
        const syncToolbarButton = document.getElementById("syncNowToolbarButton");
        const appSettingsToolbarButton = document.getElementById("appSettingsToolbarButton");
        if (adminToolbarButton) {
          adminToolbarButton.hidden = !currentUser || viewId === "loginView";
        }
        if (syncToolbarButton) {
          syncToolbarButton.hidden = !currentUser || viewId === "loginView";
        }
        if (appSettingsToolbarButton) {
          appSettingsToolbarButton.hidden = !currentUser || viewId === "loginView";
        }
        if (viewId === "dashboardView" || viewId === "loginView") {
          homeBtn.style.display = "none";
        } else {
          homeBtn.style.display = "flex";
        }

        if (
          pushHistory &&
          currentActiveViewId !== viewId &&
          viewId !== "loginView"
        ) {
          history.pushState({ view: viewId }, "", "");
        }

        currentActiveViewId = viewId;
        window.scrollTo({ top: 0, behavior: "smooth" });

        if (viewId === "attendanceReportView" && viewChanged) {
          selectAttendanceReportTab(attendanceReportTab, true);
        }
        if (viewId === "currentAttendeesView" && viewChanged) {
          showCurrentAttendeesSkeleton();
          loadCurrentAttendees(false);
          currentAttendeesRefreshTimer = window.setInterval(
            () => loadCurrentAttendees(false),
            30000,
          );
        }
        if (viewId === "dashboardView") {
          refreshCurrentAttendeesWindow();
        }
        if (viewId === "scanView") {
          isProcessingScan = false;
          setTimeout(startLiveScanner, 150);
        }
      }

      function localDateInputValue(date) {
        return [
          date.getFullYear(),
          String(date.getMonth() + 1).padStart(2, "0"),
          String(date.getDate()).padStart(2, "0"),
        ].join("-");
      }

      function getPastAttendanceDates(dates, today = localDateInputValue(new Date())) {
        return dates
          .filter((date) => {
            if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date > today) return false;
            const [year, month, day] = date.split("-").map(Number);
            const parsed = new Date(year, month - 1, day);
            return parsed.getFullYear() === year &&
              parsed.getMonth() === month - 1 &&
              parsed.getDate() === day;
          })
          .sort();
      }

      function formatAttendanceDateOption(date, today) {
        const [year, month, day] = date.split("-").map(Number);
        const formattedDate = new Date(year, month - 1, day, 12).toLocaleDateString(
          currentLang === "ar" ? "ar" : "en",
          { year: "numeric", month: "short", day: "numeric" },
        );
        return date === today
          ? `${translations[currentLang].today} · ${formattedDate}`
          : formattedDate;
      }

      function openAttendanceReport(tab = "attendance") {
        const alreadyOpen = currentActiveViewId === "attendanceReportView";
        attendanceReportTab = tab;
        showView("attendanceReportView");
        if (alreadyOpen) selectAttendanceReportTab(tab);
      }

      function openAppSettings() {
        if (!currentUser) return;
        showView("appSettingsView");
      }

      function openCurrentAttendeesView() {
        if (!currentAttendeesWindowOpen) return;
        const alreadyOpen = currentActiveViewId === "currentAttendeesView";
        showView("currentAttendeesView");
        if (alreadyOpen) loadCurrentAttendees();
      }

      function showCurrentAttendeesSkeleton() {
        const container = document.getElementById("currentAttendeesResults");
        if (!container) return;
        const skeleton = document.createElement("div");
        skeleton.className = "report-loading current-attendees-loading";
        skeleton.setAttribute("role", "status");
        skeleton.setAttribute("aria-label", translations[currentLang].loadingReport);
        for (let index = 0; index < 3; index++) {
          const row = document.createElement("div");
          row.className = "report-skeleton-row";
          row.innerHTML = "<span></span><span></span><span></span>";
          skeleton.appendChild(row);
        }
        container.replaceChildren(skeleton);
      }

      function updateCurrentAttendees() {
        return loadCurrentAttendees(true, translations[currentLang].updatingAttendance);
      }

      async function refreshCurrentAttendeesWindow() {
        if (currentAttendeesWindowTimer) {
          window.clearTimeout(currentAttendeesWindowTimer);
          currentAttendeesWindowTimer = 0;
        }
        const requestId = ++currentAttendeesWindowRequestId;
        const requestStartedAt = Date.now();
        let nextWindowCheckMs = 30000;
        const tile = document.getElementById("currentAttendeesTile");
        if (!tile) return;
        currentAttendeesWindowOpen = false;
        tile.disabled = true;
        tile.setAttribute("aria-busy", "true");
        if (!currentUser || !navigator.onLine || currentActiveViewId !== "dashboardView") {
          tile.removeAttribute("aria-busy");
          return;
        }
        try {
          const result = await apiCall("get_attendance_window");
          if (requestId !== currentAttendeesWindowRequestId) return;
          currentAttendeesWindowOpen = Boolean(result && result.success && result.windowOpen);
          if (Number.isFinite(Number(result?.nextCheckMs))) {
            nextWindowCheckMs = Number(result.nextCheckMs);
          }
        } catch (error) {
          console.error("Could not check the current-attendance window.", error);
          currentAttendeesWindowOpen = false;
        } finally {
          if (requestId === currentAttendeesWindowRequestId) {
            tile.disabled = !navigator.onLine || !currentAttendeesWindowOpen;
            tile.removeAttribute("aria-busy");
            if (navigator.onLine && currentUser && currentActiveViewId === "dashboardView") {
              const delay = Math.max(1000, nextWindowCheckMs - (Date.now() - requestStartedAt));
              currentAttendeesWindowTimer = window.setTimeout(
                refreshCurrentAttendeesWindow,
                Math.min(delay, 2147483647),
              );
            }
          }
        }
      }

      async function loadCurrentAttendees(showLoading = true, loaderText = "Loading current attendance...") {
        const availability = document.getElementById("currentAttendeesAvailability");
        const container = document.getElementById("currentAttendeesResults");
        if (currentActiveViewId !== "currentAttendeesView") return;
        if (
          !showLoading &&
          (document.hidden || document.getElementById("emergencyCheckoutDialog").open)
        ) return;
        const requestId = ++currentAttendeesRequestId;
        const mainContainer = document.getElementById("mainContainer");
        const scrollPosition = mainContainer.scrollTop;
        if (showLoading) showLoader(loaderText);
        try {
          const result = await apiCall("get_current_attendees");
          if (requestId !== currentAttendeesRequestId || currentActiveViewId !== "currentAttendeesView") return;
          if (!result || !result.success || !Array.isArray(result.attendees)) {
            throw new Error(result && result.message ? result.message : translations[currentLang].offlineSyncFailed);
          }
          const snapshot = JSON.stringify(result);
          availability.textContent = result.windowOpen
            ? translations[currentLang].attendanceWindowOpen
            : translations[currentLang].attendanceWindowClosed;
          availability.classList.toggle("is-open", result.windowOpen);
          availability.classList.toggle("is-closed", !result.windowOpen);
          const refreshButton = document.getElementById("refreshCurrentAttendeesButton");
          if (refreshButton) refreshButton.disabled = !navigator.onLine || !result.windowOpen;
          if (!result.windowOpen) {
            currentAttendeesWindowOpen = false;
            currentAttendeesCheckoutOpen = false;
            currentAttendeesData = [];
            const closed = document.createElement("p");
            closed.className = "report-note";
            closed.textContent = translations[currentLang].attendanceWindowClosed;
            container.replaceChildren(closed);
            currentAttendeesData = [];
            currentAttendeesSnapshot = snapshot;
            return;
          }
          if (!showLoading && snapshot === currentAttendeesSnapshot) return;
          currentAttendeesSnapshot = snapshot;
          currentAttendeesData = result.attendees;
          currentAttendeesCheckoutOpen = result.checkoutOpen;
          renderCurrentAttendees(result.checkoutOpen);
          mainContainer.scrollTop = scrollPosition;
        } catch (error) {
          if (requestId !== currentAttendeesRequestId) return;
          availability.textContent = error.message || translations[currentLang].offlineSyncFailed;
          availability.classList.add("is-closed");
          if (showLoading) showToast(error.message || translations[currentLang].offlineSyncFailed, "error");
        } finally {
          if (showLoading) hideLoader();
        }
      }

      function renderCurrentAttendees(checkoutOpen) {
        const container = document.getElementById("currentAttendeesResults");
        const query = document.getElementById("currentAttendeesSearch").value.trim().toLocaleLowerCase();
        const attendees = currentAttendeesData.filter((person) =>
          `${person.name || ""} ${person.checkedInBy || ""}`.toLocaleLowerCase().includes(query),
        );
        if (!attendees.length) {
          const empty = document.createElement("p");
          empty.className = "report-note";
          empty.textContent = currentAttendeesData.length
            ? translations[currentLang].currentAttendeesNoMatches
            : translations[currentLang].noCurrentAttendees;
          container.replaceChildren(empty);
          return;
        }
        const panel = document.createElement("section");
        panel.className = "report-panel";
        const heading = document.createElement("div");
        heading.className = "report-panel-heading";
        const title = document.createElement("strong");
        title.textContent = `${translations[currentLang].currentAttendeesTitle} · ${attendees.length}`;
        heading.appendChild(title);
        panel.appendChild(heading);
        const table = document.createElement("div");
        table.className = "current-attendees-table";
        table.setAttribute("role", "table");
        const header = document.createElement("div");
        header.className = "current-attendees-row current-attendees-header";
        header.setAttribute("role", "row");
        [
          translations[currentLang].studentNameLabel,
          translations[currentLang].currentAttendeesAdminTime,
          translations[currentLang].currentAttendeesActions,
        ].forEach((label) => {
          const cell = document.createElement("strong");
          cell.setAttribute("role", "columnheader");
          cell.textContent = label;
          header.appendChild(cell);
        });
        table.appendChild(header);
        attendees.forEach((person) => {
          const row = document.createElement("div");
          row.className = "current-attendees-row";
          row.setAttribute("role", "row");
          const nameCell = document.createElement("strong");
          nameCell.setAttribute("role", "cell");
          nameCell.textContent = person.name;
          const metaCell = document.createElement("div");
          metaCell.className = "current-attendees-meta";
          metaCell.setAttribute("role", "cell");
          const admin = document.createElement("span");
          admin.textContent = person.checkedInBy || "—";
          const time = document.createElement("time");
          time.dateTime = person.checkinTime ? new Date(person.checkinTime).toISOString() : "";
          time.textContent = person.checkinTime
            ? new Date(person.checkinTime).toLocaleTimeString(
                currentLang === "ar" ? "ar" : "en",
                { hour: "2-digit", minute: "2-digit" },
              )
            : "";
          metaCell.append(admin, time);
          const actions = document.createElement("div");
          actions.className = "current-attendees-actions";
          actions.setAttribute("role", "cell");
          if (checkoutOpen) {
            const checkoutButton = document.createElement("button");
            checkoutButton.type = "button";
            checkoutButton.className = "btn secondary";
            checkoutButton.dataset.onlineOnly = "";
            checkoutButton.textContent = translations[currentLang].attendanceCheckout;
            checkoutButton.addEventListener("click", () => checkoutAttendance(person.id));
            actions.appendChild(checkoutButton);
          }
          const emergencyButton = document.createElement("button");
          emergencyButton.type = "button";
          emergencyButton.className = "btn secondary emergency-checkout-button";
          emergencyButton.dataset.onlineOnly = "";
          emergencyButton.textContent = translations[currentLang].emergencyCheckout;
          emergencyButton.addEventListener("click", () => showEmergencyCheckoutDialog(person));
          actions.appendChild(emergencyButton);
          const cancelButton = document.createElement("button");
          cancelButton.type = "button";
          cancelButton.className = "btn secondary attendance-cancel-button";
          cancelButton.dataset.onlineOnly = "";
          cancelButton.textContent = translations[currentLang].attendanceCancelCheckin;
          cancelButton.addEventListener("click", () => cancelAttendanceCheckin(person.id));
          actions.appendChild(cancelButton);
          row.append(nameCell, metaCell, actions);
          table.appendChild(row);
        });
        panel.appendChild(table);
        container.replaceChildren(panel);
        updateOnlineOnlyControls();
      }

      function filterCurrentAttendees() {
        renderCurrentAttendees(currentAttendeesCheckoutOpen);
      }

      function showEmergencyCheckoutDialog(person) {
        currentEmergencyCheckoutId = person.id;
        document.getElementById("emergencyCheckoutAttendee").textContent = person.name;
        const reason = document.getElementById("emergencyCheckoutReason");
        reason.value = "";
        const dialog = document.getElementById("emergencyCheckoutDialog");
        if (!dialog.open) dialog.showModal();
        window.setTimeout(() => reason.focus(), 0);
      }

      function closeEmergencyCheckoutDialog() {
        const dialog = document.getElementById("emergencyCheckoutDialog");
        if (dialog.open) dialog.close();
        currentEmergencyCheckoutId = "";
      }

      async function submitEmergencyCheckout(event) {
        event.preventDefault();
        const id = currentEmergencyCheckoutId;
        const actionKey = `emergency:${id}`;
        if (!id || currentAttendeeActionsInFlight.has(actionKey)) return;
        const reasonInput = document.getElementById("emergencyCheckoutReason");
        const cleanReason = reasonInput.value.replace(/\s+/g, " ").trim();
        if (cleanReason.length < 5 || cleanReason.length > 500) {
          reasonInput.setCustomValidity(translations[currentLang].emergencyCheckoutReason);
          reasonInput.reportValidity();
          return;
        }
        reasonInput.setCustomValidity("");
        currentAttendeeActionsInFlight.add(actionKey);
        const submit = document.getElementById("emergencyCheckoutSubmit");
        submit.disabled = true;
        try {
          const result = await apiCall("emergency_checkout_attendance", {
            id: id,
            reason: cleanReason,
          });
          if (!result || result.kind !== "out") {
            throw new Error(result && result.message ? result.message : translations[currentLang].offlineSyncFailed);
          }
          closeEmergencyCheckoutDialog();
          showToast(translations[currentLang].emergencyCheckoutCompleted, "success");
          await loadCurrentAttendees();
        } catch (error) {
          showToast(error.message || translations[currentLang].offlineSyncFailed, "error");
        } finally {
          currentAttendeeActionsInFlight.delete(actionKey);
          submit.disabled = false;
        }
      }

      function selectAttendanceReportTab(tab, forceReload = false) {
        attendanceReportTab = tab === "followups" ? "followups" : "attendance";
        const attendancePanel = document.getElementById("attendanceTabPanel");
        const followupPanel = document.getElementById("followupTabPanel");
        const attendanceButton = document.getElementById("attendanceTabButton");
        const followupButton = document.getElementById("followupTabButton");
        const tabs = document.querySelector(".report-tabs");
        const isFollowups = attendanceReportTab === "followups";
        tabs.dataset.activeTab = attendanceReportTab;
        attendancePanel.hidden = isFollowups;
        followupPanel.hidden = !isFollowups;
        const activePanel = isFollowups ? followupPanel : attendancePanel;
        activePanel.classList.remove("report-panel-enter");
        window.requestAnimationFrame(() => activePanel.classList.add("report-panel-enter"));
        attendanceButton.classList.toggle("is-active", !isFollowups);
        followupButton.classList.toggle("is-active", isFollowups);
        attendanceButton.setAttribute("aria-selected", String(!isFollowups));
        followupButton.setAttribute("aria-selected", String(isFollowups));
        if (isFollowups) loadFollowups();
        else if (forceReload || document.getElementById("attendanceReportDate").options.length <= 1) {
          loadAttendanceReportDates();
        }
      }

      async function loadAttendanceReportDates() {
        const requestId = ++attendanceReportRequestId;
        const select = document.getElementById("attendanceReportDate");
        if (!select) return;
        select.disabled = true;
        select.dataset.busy = "true";
        const loadingOption = document.createElement("option");
        loadingOption.value = "";
        loadingOption.textContent = translations[currentLang].attendanceDatesLoading;
        select.replaceChildren(loadingOption);
        showReportSkeleton(document.getElementById("attendanceReportResults"));
        document.getElementById("attendanceSearchResult").replaceChildren();
        try {
          const result = await apiCall("get_attendance_dates");
          if (
            requestId !== attendanceReportRequestId ||
            currentActiveViewId !== "attendanceReportView" ||
            attendanceReportTab !== "attendance"
          ) return;
          if (!result || !result.success || !Array.isArray(result.dates)) {
            throw new Error(result && result.message ? result.message : translations[currentLang].attendanceDatesFailed);
          }
          select.replaceChildren();
          const today = localDateInputValue(new Date());
          const dates = getPastAttendanceDates(result.dates, today);
          if (!dates.length) {
            const emptyOption = document.createElement("option");
            emptyOption.value = "";
            emptyOption.textContent = translations[currentLang].attendanceDatesEmpty;
            select.appendChild(emptyOption);
            document.getElementById("attendanceReportResults").replaceChildren();
            return;
          }
          dates.forEach((date) => {
            const option = document.createElement("option");
            option.value = date;
            option.textContent = formatAttendanceDateOption(date, today);
            select.appendChild(option);
          });
          select.value = dates[dates.length - 1];
          delete select.dataset.busy;
          select.disabled = false;
          await loadAttendanceReport();
        } catch (error) {
          if (requestId !== attendanceReportRequestId) return;
          select.replaceChildren();
          const errorOption = document.createElement("option");
          errorOption.value = "";
          errorOption.textContent = translations[currentLang].attendanceDatesFailed;
          select.appendChild(errorOption);
          showToast(error.message || translations[currentLang].attendanceDatesFailed, "error");
        } finally {
          if (requestId === attendanceReportRequestId) {
            delete select.dataset.busy;
            select.disabled = !navigator.onLine;
          }
        }
      }

      async function loadFollowups() {
        const requestId = ++attendanceReportRequestId;
        const container = document.getElementById("followupResults");
        showReportSkeleton(container);
        try {
          const result = await apiCall("get_followups");
          if (
            requestId !== attendanceReportRequestId ||
            currentActiveViewId !== "attendanceReportView" ||
            attendanceReportTab !== "followups"
          ) return;
          if (!result || !result.success) throw new Error(result && result.message);
          followupReportPeople = Array.isArray(result.followups) ? result.followups : [];
          renderFollowupResults();
          updateOnlineOnlyControls();
        } catch (error) {
          if (requestId !== attendanceReportRequestId) return;
          container.replaceChildren();
          showToast(error.message || translations[currentLang].offlineSyncFailed, "error");
        }
      }

      function filterFollowups() {
        renderFollowupResults();
      }

      function renderFollowupResults() {
        const container = document.getElementById("followupResults");
        const query = document.getElementById("followupPersonQuery").value.trim().toLocaleLowerCase();
        const people = followupReportPeople.filter((person) =>
          String(person.name || "").toLocaleLowerCase().includes(query),
        );
        if (!people.length) {
          const empty = document.createElement("p");
          empty.className = "search-empty";
          if (query && followupReportPeople.length) {
            empty.textContent = translations[currentLang].followupNoMatches;
          } else if (!query) {
            empty.textContent = translations[currentLang].noFollowups;
          } else {
            return;
          }
          container.replaceChildren(empty);
          return;
        }
        container.replaceChildren();
        const panel = document.createElement("section");
        panel.className = "report-panel";
        const heading = document.createElement("div");
        heading.className = "report-panel-heading";
        heading.textContent = translations[currentLang].followupsTitle;
        panel.appendChild(heading);
        people.forEach((person) => {
          const item = document.createElement("article");
          item.className = "attendance-person-card followup-person-card";
          const details = document.createElement("div");
          const name = document.createElement("strong");
          name.textContent = person.name;
          const note = document.createElement("small");
          note.style.cssText = "display:block;color:var(--text-sub);margin-top:4px;";
          note.textContent = `${person.missedMeetings} · ${person.lastMissed}`;
          details.append(name, note);
          const completeButton = document.createElement("button");
          completeButton.type = "button";
          completeButton.className = "btn secondary";
          completeButton.dataset.onlineOnly = "";
          completeButton.style.cssText = "width:auto;margin:0;padding:8px 10px;";
          completeButton.textContent = translations[currentLang].markFollowupComplete;
          completeButton.addEventListener("click", () => completeAttendanceFollowup(person.id));
          item.append(details, completeButton);
          panel.appendChild(item);
        });
        container.appendChild(panel);
        updateOnlineOnlyControls();
      }

      async function completeAttendanceFollowup(id) {
        try {
          const result = await apiCall("complete_followup", { id: id });
          if (!result || !result.success) throw new Error(result && result.message);
          showToast(translations[currentLang].followupCompleted, "success");
          await loadFollowups();
        } catch (error) {
          showToast(error.message || translations[currentLang].offlineSyncFailed, "error");
        }
      }

      function renderAttendanceReport(report, query, created) {
        const list = document.getElementById("attendanceReportResults");
        const searchResult = document.getElementById("attendanceSearchResult");
        attendanceReportData = report;
        list.replaceChildren();
        searchResult.replaceChildren();
        const attendanceFilter = document.getElementById("attendanceStatusFilter").value;
        const visiblePeople = report.people.filter((person) =>
          attendanceFilter === "all" ||
          (attendanceFilter === "attended" && person.attended) ||
          (attendanceFilter === "absent" && !person.attended),
        );
        const resultPanel = query
          ? document.createElement("section")
          : null;
        if (resultPanel) {
          resultPanel.className = "report-panel";
          const heading = document.createElement("div");
          heading.className = "report-panel-heading";
          heading.textContent = translations[currentLang].attendanceSearchResults;
          resultPanel.appendChild(heading);
        }

        const summary = document.createElement("p");
        summary.className = "report-panel-heading";
        summary.textContent = `${report.date} · ${report.count}`;
        const panel = document.createElement("section");
        panel.className = "report-panel";
        panel.appendChild(summary);
        const table = document.createElement("div");
        table.className = "attendance-report-table";
        table.setAttribute("role", "table");
        const header = document.createElement("div");
        header.className = "attendance-report-row attendance-report-header";
        header.setAttribute("role", "row");
        const nameHeader = document.createElement("strong");
        nameHeader.setAttribute("role", "columnheader");
        nameHeader.textContent = translations[currentLang].studentNameLabel;
        const stateHeader = document.createElement("strong");
        stateHeader.setAttribute("role", "columnheader");
        stateHeader.textContent = translations[currentLang].attendanceStateLabel;
        header.append(nameHeader, stateHeader);
        table.appendChild(header);
        if (!visiblePeople.length) {
          const empty = document.createElement("p");
          empty.className = "search-empty";
          empty.textContent = translations[currentLang].attendanceFilterNoResults;
          table.appendChild(empty);
        }
        visiblePeople.forEach((person) => {
          const item = document.createElement("div");
          item.className = "attendance-report-row";
          item.setAttribute("role", "row");
          const name = document.createElement("strong");
          name.setAttribute("role", "cell");
          name.textContent = person.name;
          const state = document.createElement("span");
          state.setAttribute("role", "cell");
          state.className = `attendance-state attendance-state-${person.state || (person.attended ? "on_time" : "absent")}`;
          state.textContent = person.state === "delayed"
            ? person.delay
              ? translations[currentLang].attendanceWithDelay.replace("{delay}", person.delay)
              : translations[currentLang].attendanceDelayed
            : person.attended
              ? translations[currentLang].attendanceOnTime
              : translations[currentLang].absent;
          item.append(name, state);
          table.appendChild(item);
        });
        panel.appendChild(table);
        list.appendChild(panel);

        if (query) {
          if (!report.matches.length) {
            const empty = document.createElement("p");
            empty.className = "search-empty";
            empty.textContent = translations[currentLang].attendanceNoMatches;
            resultPanel.appendChild(empty);
          }
          report.matches.forEach((person) => {
            const item = document.createElement("div");
            item.className = "attendance-report-match";
            const name = document.createElement("strong");
            name.textContent = person.name;
            const state = document.createElement("span");
            state.className = `attendance-state attendance-state-${person.state || (person.attended ? "on_time" : "absent")}`;
            state.textContent = person.state === "delayed"
              ? person.delay
                ? translations[currentLang].attendanceWithDelay.replace("{delay}", person.delay)
                : translations[currentLang].attendanceDelayed
              : person.attended
                ? translations[currentLang].attendanceOnTime
                : translations[currentLang].absent;
            item.append(name, state);
            resultPanel.appendChild(item);
          });
        }
        if (query) {
          addSearchAgainButton(resultPanel, document.getElementById("attendancePersonQuery"));
        }
        if (resultPanel) searchResult.appendChild(resultPanel);
        if (created && report.report) showAttendanceSheetResult(report);
      }

      function filterAttendanceReport() {
        if (attendanceReportData) {
          renderAttendanceReport(
            attendanceReportData,
            document.getElementById("attendancePersonQuery").value.trim(),
            false,
          );
        }
      }

      function showAttendanceSheetResult(report) {
        const dialog = document.getElementById("attendanceSheetResultDialog");
        const date = formatAttendanceDateOption(report.date, localDateInputValue(new Date()));
        const sheetMessage = report.report.alreadyExists
          ? translations[currentLang].attendanceSheetAlreadyExistsMessage
          : translations[currentLang].attendanceSheetCreatedMessage
              .replace("{total}", report.people.length)
              .replace("{attended}", report.count);
        document.getElementById("attendanceSheetResultMessage").textContent = `${sheetMessage} · ${date}`;
        document.getElementById("attendanceSheetOpenLink").href =
          `${GOOGLE_SHEET_URL}#gid=${report.report.sheetId}`;
        if (!dialog.open) dialog.showModal();
      }

      function closeAttendanceSheetResult() {
        const dialog = document.getElementById("attendanceSheetResultDialog");
        if (dialog.open) dialog.close();
      }

      async function loadAttendanceReport(createSheet = false) {
        const requestId = ++attendanceReportRequestId;
        const date = document.getElementById("attendanceReportDate").value;
        const query = document.getElementById("attendancePersonQuery").value.trim();
        if (!date) {
          showToast(translations[currentLang].attendancePersonPlaceholder, "info");
          return;
        }
        showReportSkeleton(
          document.getElementById("attendanceReportResults"),
          3,
          createSheet
            ? translations[currentLang].creatingAttendanceSheet
            : translations[currentLang].loadingReport,
        );
        document.getElementById("attendanceSearchResult").replaceChildren();
        const sheetButton = document.querySelector(".attendance-sheet-button");
        if (createSheet) {
          sheetButton.disabled = true;
          sheetButton.setAttribute("aria-busy", "true");
          showLoader(translations[currentLang].creatingAttendanceSheet);
        }
        try {
          const result = await apiCall(
            createSheet ? "create_daily_attendance_report" : "get_attendance_day",
            { date: date, name: query },
          );
          if (
            requestId !== attendanceReportRequestId ||
            currentActiveViewId !== "attendanceReportView" ||
            attendanceReportTab !== "attendance"
          ) return;
          if (!result || !result.success) throw new Error(result && result.message);
          renderAttendanceReport(result, createSheet ? "" : query, createSheet);
        } catch (error) {
          if (requestId !== attendanceReportRequestId) return;
          document.getElementById("attendanceReportResults").replaceChildren();
          showToast(error.message || translations[currentLang].offlineSyncFailed, "error");
        } finally {
          if (createSheet) {
            hideLoader();
            sheetButton.disabled = !navigator.onLine;
            sheetButton.removeAttribute("aria-busy");
          }
        }
      }

      function createAttendanceReportSheet() {
        loadAttendanceReport(true);
      }

      async function checkoutAttendance(id) {
        const actionKey = `checkout:${id}`;
        if (currentAttendeeActionsInFlight.has(actionKey)) return;
        if (!window.confirm(translations[currentLang].confirmAttendanceCheckout)) return;
        currentAttendeeActionsInFlight.add(actionKey);
        showLoader("Recording attendance check-out...");
        try {
          const result = await apiCall("checkout_attendance", { id: id });
          hideLoader();
          if (!result || result.kind !== "out") {
            throw new Error(result && result.message ? result.message : translations[currentLang].attendanceCheckout);
          }
          showToast(translations[currentLang].attendanceCheckoutCompleted, "success");
          if (currentActiveViewId === "currentAttendeesView") await loadCurrentAttendees();
          else await loadAttendanceReport();
        } catch (error) {
          hideLoader();
          showToast(error.message || translations[currentLang].offlineSyncFailed, "error");
        } finally {
          currentAttendeeActionsInFlight.delete(actionKey);
        }
      }

      async function cancelAttendanceCheckin(id) {
        if (!currentUser) return;
        const actionKey = `cancel:${id}`;
        if (currentAttendeeActionsInFlight.has(actionKey)) return;
        if (!window.confirm(translations[currentLang].confirmCancelCheckin)) return;
        currentAttendeeActionsInFlight.add(actionKey);
        showLoader("Cancelling attendance check-in...");
        try {
          const result = await apiCall("cancel_checkin", { id: id });
          hideLoader();
          if (!result || !result.success) {
            if (result && result.code === "CHECKOUT_ALREADY_RECORDED") {
              throw new Error(translations[currentLang].checkoutAlreadyRecorded);
            }
            throw new Error(result && result.message);
          }
          showToast(translations[currentLang].attendanceCancelSuccess, "success");
          if (currentActiveViewId === "currentAttendeesView") await loadCurrentAttendees();
          else await loadAttendanceReport();
        } catch (error) {
          hideLoader();
          showToast(error.message || translations[currentLang].offlineSyncFailed, "error");
        } finally {
          currentAttendeeActionsInFlight.delete(actionKey);
        }
      }

      window.addEventListener("popstate", function (e) {
        if (activeApiRequestCount > 0 || isSyncingOfflineQueue) {
          history.pushState({ view: currentActiveViewId }, "", "");
          showToast(translations[currentLang].requestInProgress, "info");
          return;
        }
        if (e.state && e.state.view) showView(e.state.view, false);
        else showView(currentUser ? "dashboardView" : "loginView", false);
      });

      function resetView(viewId) {
        if (viewId === "searchView") {
          document.getElementById("searchNameInput").value = "";
          document.getElementById("searchResults").innerHTML = "";
        } else if (viewId === "scanView") {
          stopLiveScanner();
        } else if (viewId === "addView") {
          document.getElementById("newStudentName").value = "";
          document.getElementById("addResult").innerHTML = "";
        } else if (viewId === "cardShareView") {
          document.getElementById("shareNameInput").value = "";
          document.getElementById("shareResults").innerHTML = "";
        } else if (viewId === "attendanceReportView") {
          attendanceReportRequestId++;
          attendanceReportTab = "attendance";
          document.getElementById("attendancePersonQuery").value = "";
          document.getElementById("attendanceStatusFilter").value = "all";
          attendanceReportData = null;
          document.getElementById("attendanceReportResults").replaceChildren();
          document.getElementById("attendanceSearchResult").replaceChildren();
          document.getElementById("followupResults").replaceChildren();
          const select = document.getElementById("attendanceReportDate");
          const placeholder = document.createElement("option");
          placeholder.value = "";
          placeholder.textContent = translations[currentLang].attendanceDatesLoading;
          select.replaceChildren(placeholder);
          document.getElementById("attendanceTabPanel").hidden = false;
          document.getElementById("followupTabPanel").hidden = true;
          document.getElementById("attendanceTabButton").classList.add("is-active");
          document.getElementById("followupTabButton").classList.remove("is-active");
          document.getElementById("attendanceTabButton").setAttribute("aria-selected", "true");
          document.getElementById("followupTabButton").setAttribute("aria-selected", "false");
        } else if (viewId === "currentAttendeesView") {
          currentAttendeesRequestId++;
          currentAttendeesSnapshot = "";
          document.getElementById("currentAttendeesAvailability").replaceChildren();
          document.getElementById("currentAttendeesResults").replaceChildren();
        }
      }

      function openAdminSettings() {
        showView("adminSettingsView");
      }
      function openScheduleSettings() {
        showView("scheduleSettingsView");
      }

      window.addEventListener("online", async () => {
        await updateOfflineStatus();
        initializeGoogleSignIn();
        if (currentUser && !googleIdToken) {
          beginSessionRestore(currentUser.email);
          return;
        }
        await refreshRosterCache();
        if (currentActiveViewId === "dashboardView") refreshCurrentAttendeesWindow();
      });
      window.addEventListener("offline", updateOfflineStatus);

      function initializeNumericPasswords() {
        document.querySelectorAll(".numeric-password").forEach((input) => {
          input.addEventListener("input", () => {
            const digitsOnly = input.value.replace(/\D/g, "");
            if (input.value !== digitsOnly) input.value = digitsOnly;
          });
        });
        document.querySelectorAll("[data-password-toggle]").forEach((button) => {
          button.addEventListener("click", () => {
            const input = document.getElementById(button.dataset.passwordToggle);
            if (!input) return;
            const isVisible = input.type === "text";
            input.type = isVisible ? "password" : "text";
            const labelKey = isVisible ? "showPassword" : "hidePassword";
            button.dataset.i18n = labelKey;
            const icon = button.querySelector("i");
            if (icon) {
              icon.classList.toggle("fa-eye", !isVisible);
              icon.classList.toggle("fa-eye-slash", isVisible);
            }
            button.setAttribute("aria-label", translations[currentLang][labelKey]);
            button.setAttribute("title", translations[currentLang][labelKey]);
          });
        });
      }

      function resetPasswordVisibility(inputId) {
        const input = document.getElementById(inputId);
        const button = document.querySelector(`[data-password-toggle="${inputId}"]`);
        if (!input || !button) return;
        input.type = "password";
        button.dataset.i18n = "showPassword";
        const icon = button.querySelector("i");
        if (icon) {
          icon.classList.add("fa-eye");
          icon.classList.remove("fa-eye-slash");
        }
        button.setAttribute("aria-label", translations[currentLang].showPassword);
        button.setAttribute("title", translations[currentLang].showPassword);
      }
