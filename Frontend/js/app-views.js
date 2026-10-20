      function showToast(message, type = "error", duration = 3000) {
        const container = document.getElementById("toastContainer");
        const toast = document.createElement("div");
        toast.className = `toast ${type}`;
        toast.dataset.message = message;
        toast.innerText = translateText(message);
        container.appendChild(toast);
        setTimeout(() => {
          toast.remove();
        }, duration);
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

      function showView(viewId, pushHistory = true) {
        hideLoader();
        const viewChanged = currentActiveViewId !== viewId;
        if (currentActiveViewId && currentActiveViewId !== viewId)
          resetView(currentActiveViewId);
        if (viewId !== "currentAttendeesView" && currentAttendeesRefreshTimer) {
          window.clearInterval(currentAttendeesRefreshTimer);
          currentAttendeesRefreshTimer = 0;
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
          activeView.offsetWidth;
          activeView.classList.add(
            pushHistory ? "view-enter-forward" : "view-enter-back",
          );
          window.setTimeout(() => {
            activeView.classList.remove("view-enter-forward", "view-enter-back");
          }, 420);
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
          selectAttendanceReportTab(attendanceReportTab);
        }
        if (viewId === "currentAttendeesView" && viewChanged) {
          loadCurrentAttendees();
          currentAttendeesRefreshTimer = window.setInterval(
            () => loadCurrentAttendees(false),
            30000,
          );
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
        const alreadyOpen = currentActiveViewId === "currentAttendeesView";
        showView("currentAttendeesView");
        if (alreadyOpen) loadCurrentAttendees();
      }

      async function loadCurrentAttendees(showLoading = true) {
        const availability = document.getElementById("currentAttendeesAvailability");
        const container = document.getElementById("currentAttendeesResults");
        if (currentActiveViewId !== "currentAttendeesView") return;
        if (
          !showLoading &&
          (document.hidden || document.querySelector(".emergency-checkout-form"))
        ) return;
        const requestId = ++currentAttendeesRequestId;
        const mainContainer = document.getElementById("mainContainer");
        const scrollPosition = mainContainer.scrollTop;
        container.replaceChildren();
        if (showLoading) showLoader();
        try {
          const result = await apiCall("get_current_attendees");
          if (showLoading) hideLoader();
          if (requestId !== currentAttendeesRequestId || currentActiveViewId !== "currentAttendeesView") return;
          if (!result || !result.success || !Array.isArray(result.attendees)) {
            throw new Error(result && result.message ? result.message : translations[currentLang].offlineSyncFailed);
          }
          availability.replaceChildren();
          availability.textContent = result.windowOpen
            ? translations[currentLang].attendanceWindowOpen
            : translations[currentLang].attendanceWindowClosed;
          availability.classList.toggle("is-open", result.windowOpen);
          availability.classList.toggle("is-closed", !result.windowOpen);
          if (!result.windowOpen || !result.attendees.length) {
            const empty = document.createElement("p");
            empty.className = "report-note";
            empty.textContent = result.windowOpen
              ? translations[currentLang].noCurrentAttendees
              : translations[currentLang].attendanceWindowClosed;
            container.appendChild(empty);
            return;
          }
          const panel = document.createElement("section");
          panel.className = "report-panel";
          const heading = document.createElement("div");
          heading.className = "report-panel-heading";
          const title = document.createElement("strong");
          title.textContent = `${translations[currentLang].currentAttendeesTitle} · ${result.attendees.length}`;
          heading.appendChild(title);
          panel.appendChild(heading);
          result.attendees.forEach((person) => {
            const item = document.createElement("article");
            item.className = "attendance-person-card";
            const details = document.createElement("div");
            const name = document.createElement("strong");
            name.textContent = person.name;
            const metadata = document.createElement("small");
            const checkinTime = person.checkinTime
              ? new Date(person.checkinTime).toLocaleTimeString(currentLang === "ar" ? "ar" : "en", {
                  hour: "2-digit",
                  minute: "2-digit",
                })
              : "";
            metadata.textContent = [checkinTime, person.checkedInBy].filter(Boolean).join(" · ");
            details.append(name, metadata);
            const actions = document.createElement("div");
            actions.className = "attendance-person-actions";
            if (result.checkoutOpen) {
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
            emergencyButton.addEventListener("click", () => showEmergencyCheckoutForm(item, person.id));
            actions.appendChild(emergencyButton);
            const cancelButton = document.createElement("button");
            cancelButton.type = "button";
            cancelButton.className = "btn secondary attendance-cancel-button";
            cancelButton.dataset.onlineOnly = "";
            cancelButton.textContent = translations[currentLang].attendanceCancelCheckin;
            cancelButton.addEventListener("click", () => cancelAttendanceCheckin(person.id));
            actions.appendChild(cancelButton);
            item.append(details, actions);
            panel.appendChild(item);
          });
          container.appendChild(panel);
          updateOnlineOnlyControls();
          mainContainer.scrollTop = scrollPosition;
        } catch (error) {
          if (showLoading) hideLoader();
          if (requestId !== currentAttendeesRequestId) return;
          availability.textContent = error.message || translations[currentLang].offlineSyncFailed;
          availability.classList.add("is-closed");
          if (showLoading) showToast(error.message || translations[currentLang].offlineSyncFailed, "error");
        }
      }

      function showEmergencyCheckoutForm(item, id) {
        if (item.querySelector(".emergency-checkout-form")) return;
        const form = document.createElement("form");
        form.className = "emergency-checkout-form";
        const reason = document.createElement("textarea");
        reason.required = true;
        reason.minLength = 5;
        reason.maxLength = 500;
        reason.rows = 3;
        reason.placeholder = translations[currentLang].emergencyCheckoutReason;
        reason.setAttribute("aria-label", translations[currentLang].emergencyCheckoutReason);
        const submit = document.createElement("button");
        submit.type = "submit";
        submit.className = "btn emergency-checkout-submit";
        submit.dataset.onlineOnly = "";
        submit.textContent = translations[currentLang].emergencyCheckout;
        const cancel = document.createElement("button");
        cancel.type = "button";
        cancel.className = "btn secondary";
        cancel.textContent = translations[currentLang].cancelEmergencyCheckout;
        cancel.addEventListener("click", () => form.remove());
        form.append(reason, submit, cancel);
        updateOnlineOnlyControls();
        form.addEventListener("submit", async (event) => {
          event.preventDefault();
          const cleanReason = reason.value.replace(/\s+/g, " ").trim();
          if (cleanReason.length < 5 || cleanReason.length > 500) {
            reason.setCustomValidity(translations[currentLang].emergencyCheckoutReason);
            reason.reportValidity();
            return;
          }
          reason.setCustomValidity("");
          if (!window.confirm(translations[currentLang].confirmEmergencyCheckout)) return;
          submit.disabled = true;
          submit.dataset.busy = "true";
          try {
            const result = await apiCall("emergency_checkout_attendance", {
              id: id,
              reason: cleanReason,
            });
            if (!result || result.kind !== "out") {
              throw new Error(result && result.message ? result.message : translations[currentLang].offlineSyncFailed);
            }
            showToast(translations[currentLang].emergencyCheckoutCompleted, "success");
            await loadCurrentAttendees();
          } catch (error) {
            delete submit.dataset.busy;
            submit.disabled = false;
            showToast(error.message || translations[currentLang].offlineSyncFailed, "error");
          }
        });
        item.appendChild(form);
        reason.focus();
      }

      function selectAttendanceReportTab(tab) {
        attendanceReportTab = tab === "followups" ? "followups" : "attendance";
        const attendancePanel = document.getElementById("attendanceTabPanel");
        const followupPanel = document.getElementById("followupTabPanel");
        const attendanceButton = document.getElementById("attendanceTabButton");
        const followupButton = document.getElementById("followupTabButton");
        const isFollowups = attendanceReportTab === "followups";
        attendancePanel.hidden = isFollowups;
        followupPanel.hidden = !isFollowups;
        attendanceButton.classList.toggle("is-active", !isFollowups);
        followupButton.classList.toggle("is-active", isFollowups);
        attendanceButton.setAttribute("aria-selected", String(!isFollowups));
        followupButton.setAttribute("aria-selected", String(isFollowups));
        if (isFollowups) loadFollowups();
        else if (document.getElementById("attendanceReportDate").options.length <= 1) {
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
        document.getElementById("attendanceReportResults").replaceChildren();
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
          if (!result.dates.length) {
            const emptyOption = document.createElement("option");
            emptyOption.value = "";
            emptyOption.textContent = translations[currentLang].attendanceDatesEmpty;
            select.appendChild(emptyOption);
            return;
          }
          result.dates.forEach((date) => {
            const option = document.createElement("option");
            option.value = date;
            const [year, month, day] = date.split("-").map(Number);
            option.textContent = new Date(year, month - 1, day, 12).toLocaleDateString(
              currentLang === "ar" ? "ar" : "en",
              { year: "numeric", month: "short", day: "numeric" },
            );
            select.appendChild(option);
          });
          select.value = result.dates[result.dates.length - 1];
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
        container.replaceChildren();
        showLoader();
        try {
          const result = await apiCall("get_followups");
          hideLoader();
          if (
            requestId !== attendanceReportRequestId ||
            currentActiveViewId !== "attendanceReportView" ||
            attendanceReportTab !== "followups"
          ) return;
          if (!result || !result.success) throw new Error(result && result.message);
          if (!result.followups.length) {
            const empty = document.createElement("p");
            empty.className = "search-empty";
            empty.textContent = translations[currentLang].noFollowups;
            container.appendChild(empty);
            return;
          }
          const panel = document.createElement("section");
          panel.className = "report-panel";
          const heading = document.createElement("div");
          heading.className = "report-panel-heading";
          heading.textContent = translations[currentLang].followupsTitle;
          panel.appendChild(heading);
          result.followups.forEach((person) => {
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
        } catch (error) {
          hideLoader();
          if (requestId !== attendanceReportRequestId) return;
          showToast(error.message || translations[currentLang].offlineSyncFailed, "error");
        }
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
        list.replaceChildren();
        searchResult.replaceChildren();

        const summary = document.createElement("p");
        summary.className = "report-panel-heading";
        summary.textContent = `${report.date} · ${report.count}`;
        const panel = document.createElement("section");
        panel.className = "report-panel";
        panel.appendChild(summary);
        report.people.forEach((person) => {
          const item = document.createElement("article");
          item.className = "attendance-report-row";
          const name = document.createElement("strong");
          name.textContent = person.name;
          const details = document.createElement("small");
          const checkinTime = person.checkinTime
            ? new Date(person.checkinTime).toLocaleTimeString(currentLang === "ar" ? "ar" : "en", { hour: "2-digit", minute: "2-digit" })
            : "";
          details.textContent = [
            translations[currentLang].attended,
            checkinTime,
            person.delay,
          ].filter(Boolean).join(" · ");
          item.append(name, details, createAttendanceActions(person, report.date, report.checkoutOpen));
          panel.appendChild(item);
        });
        list.appendChild(panel);

        if (query) {
          if (!report.matches.length) {
            const empty = document.createElement("p");
            empty.className = "search-empty";
            empty.textContent = translations[currentLang].attendanceNoMatches;
            searchResult.appendChild(empty);
          }
          report.matches.forEach((person) => {
            const item = document.createElement("div");
            item.className = "attendance-report-match";
            item.textContent = `${person.name} · ${person.attended ? translations[currentLang].attended : translations[currentLang].absent}`;
            item.appendChild(createAttendanceActions(person, report.date, report.checkoutOpen));
            searchResult.appendChild(item);
          });
        }
        if (created && report.report) {
          const link = document.createElement("a");
          link.className = "btn secondary";
          link.href = `${GOOGLE_SHEET_URL}#gid=${report.report.sheetId}`;
          link.target = "_blank";
          link.rel = "noopener noreferrer";
          link.textContent = translations[currentLang].dailySheetCreated;
          searchResult.appendChild(link);
        }
        if (query) {
          addSearchAgainButton(searchResult, document.getElementById("attendancePersonQuery"));
        }
      }

      function createAttendanceActions(person, reportDate, checkoutOpen = false) {
        const actions = document.createElement("div");
        actions.className = "attendance-person-actions";
        if (!person.activeCheckin || reportDate !== localDateInputValue(new Date())) return actions;
        if (checkoutOpen) {
          const checkoutButton = document.createElement("button");
          checkoutButton.type = "button";
          checkoutButton.className = "btn secondary";
          checkoutButton.dataset.onlineOnly = "";
          checkoutButton.textContent = translations[currentLang].attendanceCheckout;
          checkoutButton.addEventListener("click", () => checkoutAttendance(person.id));
          actions.appendChild(checkoutButton);
        }
        const cancelButton = document.createElement("button");
        cancelButton.type = "button";
        cancelButton.className = "btn secondary attendance-cancel-button";
        cancelButton.dataset.onlineOnly = "";
        cancelButton.textContent = translations[currentLang].attendanceCancelCheckin;
        cancelButton.addEventListener("click", () => cancelAttendanceCheckin(person.id));
        actions.appendChild(cancelButton);
        updateOnlineOnlyControls();
        return actions;
      }

      async function loadAttendanceReport(createSheet = false) {
        const requestId = ++attendanceReportRequestId;
        const date = document.getElementById("attendanceReportDate").value;
        const query = document.getElementById("attendancePersonQuery").value.trim();
        if (!date) {
          showToast(translations[currentLang].attendancePersonPlaceholder, "info");
          return;
        }
        showLoader();
        try {
          const result = await apiCall(
            createSheet ? "create_daily_attendance_report" : "get_attendance_day",
            { date: date, name: query },
          );
          hideLoader();
          if (
            requestId !== attendanceReportRequestId ||
            currentActiveViewId !== "attendanceReportView" ||
            attendanceReportTab !== "attendance"
          ) return;
          if (!result || !result.success) throw new Error(result && result.message);
          renderAttendanceReport(result, query, createSheet);
        } catch (error) {
          hideLoader();
          if (requestId !== attendanceReportRequestId) return;
          showToast(error.message || translations[currentLang].offlineSyncFailed, "error");
        }
      }

      function createAttendanceReportSheet() {
        loadAttendanceReport(true);
      }

      async function checkoutAttendance(id) {
        if (!window.confirm(translations[currentLang].confirmAttendanceCheckout)) return;
        showLoader();
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
        }
      }

      async function cancelAttendanceCheckin(id) {
        if (!currentUser) return;
        if (!window.confirm(translations[currentLang].confirmCancelCheckin)) return;
        showLoader();
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
        }
      }

      window.addEventListener("popstate", function (e) {
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
            button.textContent = translations[currentLang][labelKey];
            button.setAttribute("aria-label", button.textContent);
          });
        });
      }

      function resetPasswordVisibility(inputId) {
        const input = document.getElementById(inputId);
        const button = document.querySelector(`[data-password-toggle="${inputId}"]`);
        if (!input || !button) return;
        input.type = "password";
        button.dataset.i18n = "showPassword";
        button.textContent = translations[currentLang].showPassword;
        button.setAttribute("aria-label", button.textContent);
      }

