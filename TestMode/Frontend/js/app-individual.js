var individualPeople = [];
var individualMeetingDates = [];
var individualSelectedPerson = null;
var individualAttendanceReport = null;
var individualRosterRequestId = 0;
var individualDatesRequestId = 0;
var individualAttendanceRequestId = 0;
var individualExportInFlight = false;

function getBirthdayWeekStart(date = new Date()) {
  const today = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const daysSinceTuesday = (today.getDay() + 5) % 7;
  today.setDate(today.getDate() - daysSinceTuesday);
  return today;
}

function isValidIndividualDateRange(fromDate, toDate) {
  const parseDate = (value) => {
    const match = String(value || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!match) return null;
    const date = new Date(
      Number(match[1]),
      Number(match[2]) - 1,
      Number(match[3]),
    );
    return date.getFullYear() === Number(match[1]) &&
      date.getMonth() === Number(match[2]) - 1 &&
      date.getDate() === Number(match[3])
      ? date
      : null;
  };
  return Boolean(parseDate(fromDate) && parseDate(toDate) && fromDate <= toDate);
}

function openIndividualSearchView() {
  const alreadyOpen = currentActiveViewId === "individualPersonView";
  showView("individualPersonView");
  if (alreadyOpen) loadIndividualPeople();
}

async function loadIndividualPeople() {
  const requestId = ++individualRosterRequestId;
  individualAttendanceRequestId++;
  individualSelectedPerson = null;
  individualAttendanceReport = null;
  individualMeetingDates = [];
  renderIndividualProfile();
  const fromInput = document.getElementById("individualAttendanceFrom");
  const toInput = document.getElementById("individualAttendanceTo");
  fromInput.value = "";
  toInput.value = "";
  fromInput.removeAttribute("min");
  fromInput.removeAttribute("max");
  toInput.removeAttribute("min");
  toInput.removeAttribute("max");
  const container = document.getElementById("individualPeopleResults");
  if (!container) return;
  showReportSkeleton(container, 3);
  try {
    const result = await apiCall("get_roster");
    if (requestId !== individualRosterRequestId) return;
    if (!result || !result.success || !Array.isArray(result.roster)) {
      throw new Error(
        result?.message || translations[currentLang].individualPeopleFailed,
      );
    }
    individualPeople = result.roster.filter((person) =>
      person && person.id !== undefined && person.name
    );
    renderIndividualPeople();
    loadIndividualMeetingDates();
  } catch (error) {
    if (requestId !== individualRosterRequestId) return;
    container.replaceChildren();
    const note = document.createElement("p");
    note.className = "report-note";
    note.textContent =
      error.message || translations[currentLang].individualPeopleFailed;
    container.appendChild(note);
  }
}

function filterIndividualPeople() {
  renderIndividualPeople();
}

function renderIndividualPeople() {
  const container = document.getElementById("individualPeopleResults");
  const query = normalizeIndividualSearchName(
    document.getElementById("individualPersonSearch").value,
  );
  const matches = individualPeople.filter((person) =>
    !query || normalizeIndividualSearchName(person.name).includes(query)
  );
  if (!matches.length) {
    const empty = document.createElement("p");
    empty.className = "report-note";
    empty.textContent = query
      ? translations[currentLang].individualPeopleNoMatches
      : translations[currentLang].individualPeopleEmpty;
    container.replaceChildren(empty);
    return;
  }
  const list = document.createElement("ul");
  list.className = "individual-people-list";
  list.setAttribute("role", "list");
  matches.forEach((person) => {
    const item = document.createElement("li");
    item.setAttribute("role", "listitem");
    const button = document.createElement("button");
    button.type = "button";
    button.className = "individual-person-result";
    button.setAttribute(
      "aria-pressed",
      String(
        individualSelectedPerson &&
          String(individualSelectedPerson.id) === String(person.id),
      ),
    );
    const name = document.createElement("strong");
    name.textContent = person.name;
    const id = document.createElement("small");
    id.textContent = `#${person.id}`;
    button.append(name, id);
    button.addEventListener("click", () => selectIndividualPerson(person.id));
    item.appendChild(button);
    list.appendChild(item);
  });
  container.replaceChildren(list);
}

function normalizeIndividualSearchName(value) {
  return String(value || "")
    .normalize("NFKC")
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function formatIndividualBirthday(value) {
  const match = String(value || "").match(/^(\d{2})-(\d{2})$/);
  if (!match) return translations[currentLang].individualInfoUnavailable;
  const month = Number(match[1]) - 1;
  const day = Number(match[2]);
  const date = new Date(Date.UTC(2000, month, day));
  if (date.getUTCMonth() !== month || date.getUTCDate() !== day)
    return translations[currentLang].individualInfoUnavailable;
  return new Intl.DateTimeFormat(currentLang === "ar" ? "ar" : "en", {
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  }).format(date);
}

function selectIndividualPerson(personId) {
  individualAttendanceRequestId++;
  individualSelectedPerson = individualPeople.find(
    (person) => String(person.id) === String(personId),
  ) || null;
  individualAttendanceReport = null;
  renderIndividualPeople();
  renderIndividualProfile();
  if (!individualSelectedPerson) return;
  if (individualMeetingDates.length) {
    setIndividualAttendanceDateDefaults();
  } else {
    renderIndividualAttendance([]);
  }
}

function renderIndividualProfile() {
  const panel = document.getElementById("individualProfilePanel");
  const attendancePanel = document.getElementById(
    "individualAttendancePanel",
  );
  const exportControls = document.getElementById("individualExportControls");
  if (!panel) return;
  if (!individualSelectedPerson) {
    panel.hidden = true;
    attendancePanel.hidden = true;
    exportControls.hidden = true;
    return;
  }
  const person = individualSelectedPerson;
  document.getElementById("individualProfileName").textContent =
    person.name || "";
  document.getElementById("individualProfileId").textContent =
    `#${person.id}`;
  document.getElementById("individualProfileBirthday").textContent =
    formatIndividualBirthday(person.birthdate);
  document.getElementById("individualProfilePhone").textContent =
    String(person.phone || "").trim() ||
    translations[currentLang].individualInfoUnavailable;
  document.getElementById("individualProfileRosterStatus").textContent =
    translations[currentLang].individualRosterActive;
  panel.hidden = false;
  attendancePanel.hidden = false;
  exportControls.hidden = !individualAttendanceReport;
}

async function loadIndividualMeetingDates() {
  const requestId = ++individualDatesRequestId;
  try {
    const result = await apiCall("get_attendance_dates");
    if (requestId !== individualDatesRequestId) return;
    if (!result || !result.success || !Array.isArray(result.dates)) {
      throw new Error(
        result?.message || translations[currentLang].individualDatesFailed,
      );
    }
    individualMeetingDates = getPastAttendanceDates(
      result.dates,
      localDateInputValue(new Date()),
    );
    if (individualSelectedPerson) setIndividualAttendanceDateDefaults();
  } catch (error) {
    if (requestId !== individualDatesRequestId) return;
    individualMeetingDates = [];
    if (individualSelectedPerson) {
      renderIndividualAttendance([]);
      showToast(
        error.message || translations[currentLang].individualDatesFailed,
        "error",
      );
    }
  }
}

function setIndividualAttendanceDateDefaults() {
  if (!individualMeetingDates.length) {
    renderIndividualAttendance([]);
    return;
  }
  const fromInput = document.getElementById("individualAttendanceFrom");
  const toInput = document.getElementById("individualAttendanceTo");
  fromInput.value = individualMeetingDates[0];
  toInput.value = individualMeetingDates[individualMeetingDates.length - 1];
  fromInput.min = individualMeetingDates[0];
  fromInput.max = individualMeetingDates[individualMeetingDates.length - 1];
  toInput.min = individualMeetingDates[0];
  toInput.max = individualMeetingDates[individualMeetingDates.length - 1];
  loadIndividualAttendance();
}

async function loadIndividualAttendance(event) {
  if (event) event.preventDefault();
  if (!individualSelectedPerson) return;
  const fromDate = document.getElementById("individualAttendanceFrom").value;
  const toDate = document.getElementById("individualAttendanceTo").value;
  if (!isValidIndividualDateRange(fromDate, toDate)) {
    showToast(translations[currentLang].individualRangeInvalid, "error");
    return;
  }
  if (!navigator.onLine) {
    showToast(translations[currentLang].individualOnlineRequired, "error");
    return;
  }

  const requestId = ++individualAttendanceRequestId;
  const submitButton = document.getElementById("individualAttendanceSubmit");
  const container = document.getElementById("individualAttendanceResults");
  submitButton.disabled = true;
  submitButton.setAttribute("aria-busy", "true");
  showReportSkeleton(container, 3);
  try {
    const result = await apiCall("get_individual_attendance", {
      id: individualSelectedPerson.id,
      fromDate,
      toDate,
    });
    if (requestId !== individualAttendanceRequestId) return;
    if (!result || !result.success || !Array.isArray(result.meetings)) {
      throw new Error(
        result?.message || translations[currentLang].individualAttendanceFailed,
      );
    }
    individualAttendanceReport = result;
    renderIndividualAttendance(result.meetings);
    document.getElementById("individualExportControls").hidden = false;
  } catch (error) {
    if (requestId !== individualAttendanceRequestId) return;
    individualAttendanceReport = null;
    document.getElementById("individualExportControls").hidden = true;
    container.replaceChildren();
    const note = document.createElement("p");
    note.className = "report-note";
    note.textContent =
      error.message || translations[currentLang].individualAttendanceFailed;
    container.appendChild(note);
  } finally {
    if (requestId === individualAttendanceRequestId) {
      submitButton.disabled = !navigator.onLine;
      submitButton.removeAttribute("aria-busy");
    }
  }
}

function renderIndividualAttendance(meetings) {
  const container = document.getElementById("individualAttendanceResults");
  if (!Array.isArray(meetings) || !meetings.length) {
    const empty = document.createElement("p");
    empty.className = "report-note";
    empty.textContent = individualMeetingDates.length
      ? translations[currentLang].individualAttendanceEmpty
      : translations[currentLang].individualDatesEmpty;
    container.replaceChildren(empty);
    return;
  }
  const table = document.createElement("table");
  table.className = "individual-attendance-table";
  const caption = document.createElement("caption");
  caption.textContent = translations[currentLang].individualAttendanceTitle;
  table.appendChild(caption);
  const head = document.createElement("thead");
  const headerRow = document.createElement("tr");
  [
    "individualMeetingDate",
    "individualMeetingType",
    "attendanceStateLabel",
    "delayLabel",
  ].forEach((key) => {
    const cell = document.createElement("th");
    cell.scope = "col";
    cell.textContent = translations[currentLang][key];
    headerRow.appendChild(cell);
  });
  head.appendChild(headerRow);
  table.appendChild(head);
  const body = document.createElement("tbody");
  meetings.forEach((meeting) => {
    const row = document.createElement("tr");
    const date = document.createElement("td");
    date.textContent = formatAttendanceDateOption(
      meeting.date,
      localDateInputValue(new Date()),
    );
    const type = document.createElement("td");
    type.textContent = meeting.meetingType ||
      translations[currentLang].individualMeetingTypeUnknown;
    const state = document.createElement("td");
    state.className = `attendance-state attendance-state-${meeting.state}`;
    state.textContent = individualAttendanceStateLabel(meeting.state);
    const delay = document.createElement("td");
    delay.textContent = meeting.delay || "—";
    row.append(date, type, state, delay);
    body.appendChild(row);
  });
  table.appendChild(body);
  container.replaceChildren(table);
}

function individualAttendanceStateLabel(state) {
  const labels = {
    present: "individualAttendancePresent",
    absent: "individualAttendanceAbsent",
    late: "individualAttendanceLate",
    unknown: "individualAttendanceUnknown",
  };
  return translations[currentLang][labels[state] || labels.unknown];
}

async function exportIndividualAttendance(format) {
  if (
    individualExportInFlight ||
    !individualAttendanceReport ||
    !["png", "pdf", "xlsx"].includes(format)
  ) return;
  if (!navigator.onLine) {
    showToast(translations[currentLang].individualOnlineRequired, "error");
    return;
  }
  if (format === "png") return downloadIndividualAttendancePng();

  const button = document.getElementById(
    format === "pdf" ? "individualExportPdf" : "individualExportExcel",
  );
  await runIndividualExport(button, async () => {
    const result = await apiCall("export_individual_attendance_report", {
      id: individualAttendanceReport.person.id,
      fromDate: individualAttendanceReport.fromDate,
      toDate: individualAttendanceReport.toDate,
      format,
    });
    downloadIndividualExportFile(result);
  });
}

async function downloadIndividualAttendancePng() {
  const button = document.getElementById("individualExportImage");
  const report = individualAttendanceReport;
  if (!report || report.meetings.length > 400) {
    showToast(translations[currentLang].individualImageRangeTooLarge, "error");
    return;
  }
  await runIndividualExport(button, async () => {
    const canvas = document.createElement("canvas");
    const width = 1400;
    const margin = 52;
    const titleHeight = 120;
    const headerHeight = 72;
    const rowHeight = 62;
    canvas.width = width;
    canvas.height =
      titleHeight + headerHeight + Math.max(1, report.meetings.length) *
        rowHeight + margin;
    const context = canvas.getContext("2d");
    if (!context)
      throw new Error(translations[currentLang].attendanceExportFailed);
    context.direction = currentLang === "ar" ? "rtl" : "ltr";
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = "#182333";
    context.font = "700 30px Arial, sans-serif";
    context.fillText(
      `${report.person.name} · ${report.fromDate} — ${report.toDate}`,
      width / 2,
      titleHeight / 2,
      width - margin * 2,
    );
    const columnWidths = [350, 330, 420, 196];
    const rows = [
      [
        translations[currentLang].individualMeetingDate,
        translations[currentLang].individualMeetingType,
        translations[currentLang].attendanceStateLabel,
        translations[currentLang].delayLabel,
      ],
      ...report.meetings.map((meeting) => [
        meeting.date,
        meeting.meetingType ||
          translations[currentLang].individualMeetingTypeUnknown,
        individualAttendanceStateLabel(meeting.state),
        meeting.delay || "—",
      ]),
    ];
    let y = titleHeight;
    rows.forEach((row, rowIndex) => {
      let x = margin;
      row.forEach((value, columnIndex) => {
        const cellWidth = columnWidths[columnIndex];
        context.fillStyle = rowIndex === 0 ? "#f5bd55" : "#ffffff";
        context.fillRect(x, y, cellWidth, rowHeight);
        context.strokeStyle = "#6b7280";
        context.lineWidth = 2;
        context.strokeRect(x, y, cellWidth, rowHeight);
        context.fillStyle = "#182333";
        context.font = rowIndex === 0
          ? "700 23px Arial, sans-serif"
          : "500 21px Arial, sans-serif";
        context.fillText(
          String(value || ""),
          x + cellWidth / 2,
          y + rowHeight / 2,
          cellWidth - 20,
        );
        x += cellWidth;
      });
      y += rowHeight;
    });
    const blob = await new Promise((resolve, reject) => {
      canvas.toBlob(
        (image) =>
          image
            ? resolve(image)
            : reject(
                new Error(translations[currentLang].attendanceExportFailed),
              ),
        "image/png",
      );
    });
    const safeId = String(report.person.id).replace(/[^A-Za-z0-9_-]/g, "_");
    triggerIndividualDownload(
      blob,
      `individual-attendance-${safeId}-${report.fromDate}-${report.toDate}.png`,
    );
  });
}

async function runIndividualExport(button, action) {
  if (!button || individualExportInFlight) return;
  const label = button.querySelector("span") || button;
  const previousLabel = label.textContent;
  individualExportInFlight = true;
  button.disabled = true;
  button.setAttribute("aria-busy", "true");
  label.textContent = translations[currentLang].downloadingAttendanceFile;
  try {
    await action();
    showToast(translations[currentLang].attendanceExportReady, "success");
  } catch (error) {
    showToast(
      error.message || translations[currentLang].attendanceExportFailed,
      "error",
    );
  } finally {
    individualExportInFlight = false;
    button.disabled = !navigator.onLine;
    button.removeAttribute("aria-busy");
    label.textContent = previousLabel;
  }
}

function downloadIndividualExportFile(result) {
  if (!result || !result.success || !result.base64) {
    throw new Error(
      result?.message || translations[currentLang].attendanceExportFailed,
    );
  }
  const bytes = Uint8Array.from(atob(result.base64), (character) =>
    character.charCodeAt(0),
  );
  const blob = new Blob([bytes], { type: result.contentType });
  triggerIndividualDownload(blob, result.filename);
}

function triggerIndividualDownload(blob, filename) {
  const objectUrl = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = objectUrl;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
}

function resetIndividualPersonView() {
  individualRosterRequestId++;
  individualDatesRequestId++;
  individualAttendanceRequestId++;
}

function refreshIndividualPersonView() {
  if (currentActiveViewId !== "individualPersonView") return;
  renderIndividualPeople();
  renderIndividualProfile();
  if (individualAttendanceReport)
    renderIndividualAttendance(individualAttendanceReport.meetings);
  else if (individualSelectedPerson)
    renderIndividualAttendance([]);
}
