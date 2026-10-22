      function openCardPreview(fileId, driveUrl, studentName) {
        activePreviewCard = {
          fileId: fileId,
          driveUrl: driveUrl,
          name: studentName,
        };
        document.getElementById("previewStudentName").innerText = studentName;

        const fetchUrl = resolveHighQualityDriveImageUrl(driveUrl);

        document.getElementById("previewCardImg").src = fetchUrl;
        showView("cardPreviewView");
      }

      function resolveHighQualityDriveImageUrl(driveUrl) {
        if (!driveUrl) return driveUrl;
        const matchId =
          (driveUrl.match(/\/d\/([a-zA-Z0-9_-]+)/) ||
            driveUrl.match(/[?&]id=([a-zA-Z0-9_-]+)/)) ||
          (driveUrl.match(/id=([a-zA-Z0-9_-]+)/) && driveUrl.match(/id=([a-zA-Z0-9_-]+)/));
        if (matchId && matchId[1]) {
          return "https://lh3.googleusercontent.com/d/" + matchId[1] + "?authuser=0&sz=w2000";
        }
        return driveUrl;
      }

      async function shareCurrentCardImage() {
        showLoader("Preparing image for sharing...");
        try {
          let fetchUrl = resolveHighQualityDriveImageUrl(activePreviewCard.driveUrl);

          const response = await fetch(fetchUrl, { mode: "cors" });
          if (!response.ok) throw new Error("Card image could not be loaded");
          const blob = await response.blob();
          const file = new File([blob], activePreviewCard.name + "_card.png", {
            type: "image/png",
          });

          if (navigator.canShare && navigator.canShare({ files: [file] })) {
            await navigator.share({
              title: "QR Card: " + activePreviewCard.name,
              text: "Church attendance card for " + activePreviewCard.name,
              files: [file],
            });
          } else {
            const a = document.createElement("a");
            a.href = URL.createObjectURL(blob);
            a.download = activePreviewCard.name + "_card.png";
            a.click();
            showToast("💾 Image downloaded successfully", "success");
          }

          if (activePreviewCard.fileId) {
            const moveResult = await apiCall("share_move_card", {
              fileId: activePreviewCard.fileId,
            });
            if (!moveResult || !moveResult.success) {
              throw new Error(moveResult && moveResult.message ? moveResult.message : "Card migration failed");
            }
          }
          hideLoader();
          showToast("✅ Shared successfully", "success");
        } catch (e) {
          hideLoader();
          if (e.name === "AbortError") return;
          if (e.message && e.message.includes("البطاقة")) showToast(e.message, "error");
          else window.open(resolveHighQualityDriveImageUrl(activePreviewCard.driveUrl), "_blank", "noopener");
        }
      }

      function openCurrentCardDrive() {
        if (activePreviewCard.driveUrl) {
          window.open(activePreviewCard.driveUrl, "_blank");
        } else {
          showToast("⚠️ Link unavailable", "error");
        }
      }

      async function submitNewStudent() {
        var name = document.getElementById("newStudentName").value.trim();
        const attendIfOpen = document.getElementById("attendNewStudent").checked;
        const submitButton = document.getElementById("btnAddStudent");
        if (submitButton.disabled) return;
        if (!name) {
          showToast("Please enter servant name", "error");
          return;
        }
        submitButton.disabled = true;
        submitButton.setAttribute("aria-busy", "true");
        const showQueuedResult = () => {
          const resultContainer = document.getElementById("addResult");
          resultContainer.replaceChildren();
          const status = document.createElement("p");
          status.className = "offline-add-queued-result";
          status.dataset.personName = name;
          status.dataset.attendIfOpen = String(attendIfOpen);
          status.textContent = [
            name,
            translations[currentLang].offlineAddQueued,
            attendIfOpen
              ? translations[currentLang].offlineAttendYes
              : translations[currentLang].offlineAttendNo,
          ].join(" · ");
          resultContainer.appendChild(status);
          document.getElementById("newStudentName").value = "";
          showToast(translations[currentLang].offlineAddQueued, "info");
        };
        const showAddedResult = (result = null) => {
          const resultContainer = document.getElementById("addResult");
          resultContainer.replaceChildren();
          const status = document.createElement("p");
          status.style.color = result?.cardGenerationFailed ? "#d97706" : "#16a34a";
          status.style.fontWeight = "bold";
          status.dataset.message = result?.cardGenerationFailed
            ? "card generation failed"
            : "Servant created successfully!";
          status.textContent = translateText(status.dataset.message);
          resultContainer.appendChild(status);
          if (result?.cardGenerationFailed && result.id) {
            const retryButton = document.createElement("button");
            retryButton.type = "button";
            retryButton.className = "btn secondary card-generation-retry";
            retryButton.dataset.onlineOnly = "";
            retryButton.textContent = translations[currentLang].retryCardGeneration;
            retryButton.addEventListener("click", () => retryServantCard(result.id, retryButton, status));
            resultContainer.appendChild(retryButton);
          }
          if (result?.driveUrl) {
            const link = document.createElement("a");
            link.href = result.driveUrl;
            link.target = "_blank";
            link.rel = "noopener noreferrer";
            link.className = "btn";
            link.style.marginTop = "10px";
            link.innerHTML = '<i class="fa-solid fa-folder-open" aria-hidden="true"></i> ';
            link.dataset.message = "Open Card in Drive";
            link.append(document.createTextNode(translateText(link.dataset.message)));
            resultContainer.appendChild(link);
          }
        };
        try {
          if (!currentUser || (navigator.onLine && !googleIdToken)) throw new Error("Offline actions require a signed-in account.");
          if (!navigator.onLine) {
            await queueOfflineEvent({ type: "add_student", name: name, attendIfOpen: attendIfOpen });
            showQueuedResult();
            return;
          }

          const event = {
            type: "add_student",
            name,
            attendIfOpen,
            eventId: crypto.randomUUID(),
            timestamp: new Date().toISOString(),
          };
          showAddedResult();
          showToast(`${name} · ${translateText("Servant created successfully!")}`, "success");
          document.getElementById("newStudentName").value = "";
          enqueueOnlineEventForSync(event).then((result) => {
            if (result && result.success === false) {
              const message = result.code === "DUPLICATE_NAME"
                ? `${translateText("duplicate attendee: ")}${result.name} (#${result.id})`
                : result.message || translations[currentLang].offlineSyncFailed;
              showToast(message, "error");
              if (currentActiveViewId === "addView") {
                const status = document.querySelector("#addResult p");
                if (status) {
                  status.dataset.message = result.message || "Failed";
                  status.textContent = message;
                  status.style.color = "#ef4444";
                }
              }
              return;
            }
            if (result && result.success) {
              if (typeof refreshAttendanceContext === "function") refreshAttendanceContext();
              if (currentActiveViewId === "addView") showAddedResult(result);
              if (result.cardGenerationFailed) {
                showToast(translateText("card generation failed"), "info");
              }
            }
          }).catch((error) => {
            console.error("Could not save the new student for background sync.", error);
            showToast(translations[currentLang].offlineStorageError, "error");
          });
        } catch (e) {
          hideLoader();
          showToast(navigator.onLine ? "Server connection error" : translations[currentLang].offlineStorageError, "error");
        } finally {
          submitButton.disabled = false;
          submitButton.removeAttribute("aria-busy");
        }
      }

      async function retryServantCard(id, button, status) {
        button.disabled = true;
        showLoader("Generating the servant card...");
        try {
          const result = await apiCall("generate_student_card", { id: id });
          if (!result || !result.success || !result.driveUrl) {
            throw new Error(result && result.message ? result.message : translations[currentLang].cardGenerationFailed);
          }
          status.textContent = translateText("Servant created successfully!");
          status.dataset.message = "Servant created successfully!";
          const link = document.createElement("a");
          link.href = result.driveUrl;
          link.target = "_blank";
          link.rel = "noopener noreferrer";
          link.className = "btn";
          link.style.marginTop = "10px";
          link.innerHTML = '<i class="fa-solid fa-folder-open" aria-hidden="true"></i> ';
          link.dataset.message = "Open Card in Drive";
          link.append(document.createTextNode(translateText(link.dataset.message)));
          button.replaceWith(link);
          showToast(translations[currentLang].cardGenerationComplete, "success");
        } catch (error) {
          button.disabled = false;
          showToast(error.message || translations[currentLang].cardGenerationFailed, "error");
        } finally {
          hideLoader();
        }
      }

      async function unlockAdminSettings() {
        var pw = document.getElementById("adminGatePassword").value.trim();
        if (!pw) {
          showToast("Please enter password", "error");
          return;
        }
        showLoader("Verifying...");
        try {
          const res = await apiCall("verify_settings_password", {
            password: pw,
          });
          hideLoader();
          if (res && res.valid) {
            verifiedPassword = pw;
            document.getElementById("adminGatePassword").value = "";
            resetPasswordVisibility("adminGatePassword");
            document.getElementById("adminSettingsLock").style.display = "none";
            document.getElementById("adminSettingsForm").style.display =
              "block";
            document.getElementById("cfgAdminName").value =
              currentUser.name || "";
            document.getElementById("cfgNewPassword").value = "";
            document.getElementById("newAdminEmail").value = "";
            document.getElementById("newAdminNameInput").value = "";
            captureAdminSettingsSnapshot();
            loadAdminsData();
          } else {
            showToast("❌ Incorrect password", "error");
          }
        } catch (e) {
          hideLoader();
          showToast("Verification error", "error");
        }
      }

      async function loadAdminsData() {
        try {
          const applyResult = (res) => {
            if (!res || !res.success || !Array.isArray(res.admins)) return;
            const container = document.getElementById("adminsListContainer");
            container.replaceChildren();
            res.admins.forEach((admin) => {
              const div = document.createElement("div");
              div.className = "admin-item";
              const details = document.createElement("div");
              const adminName = document.createElement("strong");
              adminName.textContent = admin.name;
              const email = document.createElement("span");
              email.style.cssText = "font-size:11px;color:var(--text-sub);";
              email.textContent = admin.email;
              details.append(adminName, document.createElement("br"), email);
              div.appendChild(details);
              if (!admin.isOwner) {
                const delBtn = document.createElement("button");
                delBtn.className = "admin-del-btn";
                delBtn.dataset.onlineOnly = "";
                delBtn.dataset.i18nKey = "Delete";
                delBtn.innerText = translateText("Delete");
                delBtn.onclick = () => deleteAdmin(admin.email);
                div.appendChild(delBtn);
              } else {
                const tag = document.createElement("span");
                tag.style.cssText =
                  "font-size:11px; color:var(--accent-gold); font-weight:bold;";
                tag.className = "admin-owner-tag";
                tag.dataset.i18nKey = "Owner";
                tag.innerText = translateText("Owner");
                div.appendChild(tag);
              }
              container.appendChild(div);
            });
            updateOnlineOnlyControls();
          };
          const res = await apiCall("get_admins", {}, applyResult);
          applyResult(res);
        } catch (e) {}
      }

      async function updateMyName() {
        var newName = document.getElementById("cfgAdminName").value.trim();
        if (!newName) {
          showToast("Please enter name", "error");
          return;
        }
        showLoader("Updating...");
        try {
          const res = await apiCall("update_admin_profile", {
            email: currentUser.email,
            name: newName,
            password: verifiedPassword,
          });
          hideLoader();
          if (res && res.success) {
            currentUser.name = newName;
            localStorage.setItem("app_user", JSON.stringify(currentUser));
            document.getElementById("uName").innerText = newName;
            updateAdminSettingsSnapshotField("name", newName);
            showToast(res.message, "success");
            if (!hasUnsavedSettingsChanges("adminSettingsView")) {
              showView("dashboardView");
            }
          } else {
            showToast(res.message || "Update failed", "error");
          }
        } catch (e) {
          hideLoader();
          showToast("Connection error", "error");
        }
      }

      async function addNewAdmin() {
        var email = document.getElementById("newAdminEmail").value.trim();
        var name = document.getElementById("newAdminNameInput").value.trim();
        if (!email) {
          showToast("Please enter email", "error");
          return;
        }
        showLoader("Adding...");
        try {
          const res = await apiCall("add_admin", {
            email: email,
            name: name,
            password: verifiedPassword,
          });
          hideLoader();
          if (res && res.success) {
            showToast(res.message, "success");
            document.getElementById("newAdminEmail").value = "";
            document.getElementById("newAdminNameInput").value = "";
            loadAdminsData();
          } else {
            showToast(res.message || "Failed", "error");
          }
        } catch (e) {
          hideLoader();
          showToast("Error", "error");
        }
      }

      async function deleteAdmin(email) {
        if (!confirm(translateText("Are you sure you want to delete this admin?"))) return;
        showLoader("Deleting...");
        try {
          const res = await apiCall("delete_admin", {
            email: email,
            password: verifiedPassword,
          });
          hideLoader();
          if (res && res.success) {
            showToast(res.message, "success");
            loadAdminsData();
          } else {
            showToast(res.message || "Failed", "error");
          }
        } catch (e) {
          hideLoader();
          showToast("Error", "error");
        }
      }

      async function saveAdminSettings() {
        var newPw = document.getElementById("cfgNewPassword").value.trim();
        if (!newPw) {
          showToast("⚠️ No new password entered", "info");
          return;
        }
        if (!/^\d{8,}$/.test(newPw)) {
          showToast(translations[currentLang].passwordDigitsMinimum, "error");
          document.getElementById("cfgNewPassword").focus();
          return;
        }
        showLoader("Saving...");
        try {
          const currentSet = await apiCall("get_settings");
          if (currentSet && currentSet.success) {
            var s = currentSet.settings;
            const res = await apiCall("save_settings", {
              password: verifiedPassword,
              startTime: s.startTime,
              endTime: s.endTime,
              acceptedDelay: s.acceptedDelay,
              newPassword: newPw,
              allowedDays: s.allowedDays,
            });
            hideLoader();
            if (res && res.success) {
              showToast("✅ Password changed successfully", "success");
              verifiedPassword = newPw;
              document.getElementById("cfgNewPassword").value = "";
              resetPasswordVisibility("cfgNewPassword");
              updateAdminSettingsSnapshotField("password", "");
              if (!hasUnsavedSettingsChanges("adminSettingsView")) {
                showView("dashboardView");
              }
            } else {
              showToast(res.message || "Failed", "error");
            }
          }
        } catch (e) {
          hideLoader();
          showToast("Error", "error");
        }
      }

      async function unlockScheduleSettings() {
        var pw = document.getElementById("scheduleGatePassword").value.trim();
        if (!pw) {
          showToast("Please enter password", "error");
          return;
        }
        showLoader("Verifying...");
        try {
          const res = await apiCall("verify_settings_password", {
            password: pw,
          });
          hideLoader();
          if (res && res.valid) {
            verifiedPassword = pw;
            document.getElementById("scheduleGatePassword").value = "";
            resetPasswordVisibility("scheduleGatePassword");
            document.getElementById("scheduleSettingsLock").style.display =
              "none";
            document.getElementById("scheduleSettingsForm").style.display =
              "block";
            loadScheduleSettingsData();
          } else {
            showToast("❌ Incorrect password", "error");
          }
        } catch (e) {
          hideLoader();
          showToast("Verification error", "error");
        }
      }

      async function loadScheduleSettingsData() {
        try {
          const applySettings = (res) => {
            if (!res || !res.success) return;
            if (
              scheduleSettingsSnapshot !== null &&
              getScheduleSettingsValues() !== scheduleSettingsSnapshot
            ) return;
            var s = res.settings;
            document.getElementById("cfgStartTime").value = s.startTime;
            document.getElementById("cfgEndTime").value = s.endTime;
            document.getElementById("cfgAcceptedDelay").value = s.acceptedDelay;
            var days = s.allowedDays || [0, 1, 2, 3, 4, 5, 6];
            for (let d = 0; d <= 6; d++) {
              document.getElementById("day" + d).checked = days.includes(d);
            }
            captureScheduleSettingsSnapshot();
          };
          const res = await apiCall("get_settings", {}, applySettings);
          applySettings(res);
        } catch (e) {}
      }

      async function saveScheduleSettings() {
        var allowedDays = [];
        for (let d = 0; d <= 6; d++) {
          if (document.getElementById("day" + d).checked) allowedDays.push(d);
        }
        showLoader("Saving schedule...");
        try {
          const res = await apiCall("save_settings", {
            password: verifiedPassword,
            startTime: document.getElementById("cfgStartTime").value,
            endTime: document.getElementById("cfgEndTime").value,
            acceptedDelay: document.getElementById("cfgAcceptedDelay").value,
            newPassword: "",
            allowedDays: allowedDays,
          });
          hideLoader();
          if (res && res.success) {
            showToast(res.message, "success");
            captureScheduleSettingsSnapshot();
            showView("dashboardView");
          } else {
            showToast(res.message || "Failed", "error");
          }
        } catch (e) {
          hideLoader();
          showToast("Error", "error");
        }
      }

      function getScheduleSettingsValues() {
        const days = [];
        for (let day = 0; day <= 6; day++) {
          if (document.getElementById("day" + day).checked) days.push(day);
        }
        return JSON.stringify({
          startTime: document.getElementById("cfgStartTime").value,
          endTime: document.getElementById("cfgEndTime").value,
          acceptedDelay: document.getElementById("cfgAcceptedDelay").value,
          allowedDays: days,
        });
      }

      function captureScheduleSettingsSnapshot() {
        scheduleSettingsSnapshot = getScheduleSettingsValues();
      }

      function getAdminSettingsValues() {
        return {
          name: document.getElementById("cfgAdminName").value,
          password: document.getElementById("cfgNewPassword").value,
          newAdminEmail: document.getElementById("newAdminEmail").value,
          newAdminName: document.getElementById("newAdminNameInput").value,
        };
      }

      function captureAdminSettingsSnapshot() {
        adminSettingsSnapshot = JSON.stringify(getAdminSettingsValues());
      }

      function updateAdminSettingsSnapshotField(field, value) {
        if (adminSettingsSnapshot === null) return;
        const snapshot = JSON.parse(adminSettingsSnapshot);
        snapshot[field] = value;
        adminSettingsSnapshot = JSON.stringify(snapshot);
      }

      function hasUnsavedSettingsChanges(viewId) {
        if (viewId === "scheduleSettingsView") {
          return scheduleSettingsSnapshot !== null &&
            getScheduleSettingsValues() !== scheduleSettingsSnapshot;
        }
        if (viewId === "adminSettingsView") {
          return adminSettingsSnapshot !== null &&
            JSON.stringify(getAdminSettingsValues()) !== adminSettingsSnapshot;
        }
        return false;
      }

      function discardSettingsChanges(viewId) {
        if (viewId === "adminSettingsView") {
          document.getElementById("cfgAdminName").value = currentUser.name || "";
          document.getElementById("cfgNewPassword").value = "";
          document.getElementById("newAdminEmail").value = "";
          document.getElementById("newAdminNameInput").value = "";
          resetPasswordVisibility("cfgNewPassword");
          adminSettingsSnapshot = null;
        } else if (viewId === "scheduleSettingsView") {
          scheduleSettingsSnapshot = null;
        }
      }

      if ("serviceWorker" in navigator) {
        window.addEventListener("load", () => {
          navigator.serviceWorker.register("./sw.js").catch((error) => {
            console.error("Service worker registration failed:", error);
          });
        });
      }
