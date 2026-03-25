// State
let repoPath = "";
let selectedFiles = [];
let githubBaseUrl = null;
let searchResults = [];
let currentDiffMode = "line-by-line";
let currentDiffText = "";

// Debounce helper
function debounce(fn, ms) {
    let timer;
    return function (...args) {
        clearTimeout(timer);
        timer = setTimeout(() => fn.apply(this, args), ms);
    };
}

// API helper
async function api(endpoint, body) {
    const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
    });
    return res.json();
}

// --- Saved Repos (localStorage) ---

function getSavedRepos() {
    try {
        return JSON.parse(localStorage.getItem("gitfinder_repos") || "[]");
    } catch {
        return [];
    }
}

function saveRepos(repos) {
    localStorage.setItem("gitfinder_repos", JSON.stringify(repos));
}

function renderSavedRepos() {
    const container = document.getElementById("saved-repos");
    const repos = getSavedRepos();

    if (repos.length === 0) {
        container.innerHTML = '<p class="empty-repos">No repositories added yet.</p>';
        return;
    }

    container.innerHTML = repos
        .map(
            (r) => `
            <div class="repo-item ${r.path === repoPath ? "active" : ""}" onclick="selectRepo('${escapeHtml(r.path)}')">
                <div class="repo-item-info">
                    <span class="repo-item-name">${escapeHtml(r.name)}</span>
                    <span class="repo-item-path">${escapeHtml(r.path)}</span>
                </div>
                <button class="repo-remove-btn" onclick="event.stopPropagation(); removeRepo('${escapeHtml(r.path)}')" title="Remove">&times;</button>
            </div>`
        )
        .join("");
}

async function selectRepo(path) {
    const data = await api("/api/validate-repo", { path });

    if (data.valid) {
        repoPath = data.path;
        selectedFiles = [];
        renderChips();
        document.getElementById("file-section").style.display = "";
        document.getElementById("date-section").style.display = "";
        document.getElementById("search-section").style.display = "";
        document.getElementById("results-section").style.display = "none";
        renderSavedRepos();

        api("/api/remote-url", { path: repoPath }).then((res) => {
            githubBaseUrl = res.url || null;
        });
    } else {
        alert("This repository path is no longer valid. It may have been moved or deleted.");
        removeRepo(path);
    }
}

function showAddRepoForm() {
    document.getElementById("add-repo-form").style.display = "";
    document.getElementById("show-add-btn").style.display = "none";
    document.getElementById("repo-path-input").focus();
}

function hideAddRepoForm() {
    document.getElementById("add-repo-form").style.display = "none";
    document.getElementById("show-add-btn").style.display = "";
    document.getElementById("repo-path-input").value = "";
    document.getElementById("add-repo-status").textContent = "";
}

async function addRepo() {
    const input = document.getElementById("repo-path-input");
    const status = document.getElementById("add-repo-status");
    const btn = document.getElementById("add-repo-btn");
    const path = input.value.trim();

    if (!path) {
        status.textContent = "Please enter a path";
        status.className = "status error";
        return;
    }

    btn.disabled = true;
    btn.textContent = "Checking...";
    status.textContent = "";

    const data = await api("/api/validate-repo", { path });

    if (data.valid) {
        const repos = getSavedRepos();
        if (!repos.some((r) => r.path === data.path)) {
            repos.push({ name: data.name, path: data.path });
            saveRepos(repos);
        }
        hideAddRepoForm();
        selectRepo(data.path);
    } else {
        status.textContent = data.error || "Not a valid git repository";
        status.className = "status error";
    }

    btn.disabled = false;
    btn.textContent = "Add";
}

function removeRepo(path) {
    const repos = getSavedRepos().filter((r) => r.path !== path);
    saveRepos(repos);
    if (repoPath === path) {
        repoPath = "";
        document.getElementById("file-section").style.display = "none";
        document.getElementById("date-section").style.display = "none";
        document.getElementById("search-section").style.display = "none";
        document.getElementById("results-section").style.display = "none";
    }
    renderSavedRepos();
}

// Allow Enter in add-repo input
document.getElementById("repo-path-input").addEventListener("keydown", (e) => {
    if (e.key === "Enter") addRepo();
    if (e.key === "Escape") hideAddRepoForm();
});

// Initialize saved repos on load
renderSavedRepos();

// --- Quick Date Filters ---

function applyQuickFilter(days) {
    const end = new Date();
    const start = new Date();
    start.setDate(end.getDate() - days);

    document.getElementById("start-date").value = formatISODate(start);
    document.getElementById("end-date").value = formatISODate(end);

    // Highlight active filter
    document.querySelectorAll(".quick-filter").forEach((b) => b.classList.remove("active"));
    const btn = document.querySelector(`.quick-filter[onclick="applyQuickFilter(${days})"]`);
    if (btn) btn.classList.add("active");
}

function formatISODate(date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, "0");
    const d = String(date.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
}

// Clear active filter highlight when dates are manually changed
document.getElementById("start-date").addEventListener("input", () => {
    document.querySelectorAll(".quick-filter").forEach((b) => b.classList.remove("active"));
});
document.getElementById("end-date").addEventListener("input", () => {
    document.querySelectorAll(".quick-filter").forEach((b) => b.classList.remove("active"));
});

// --- File Autocomplete ---

const fileInput = document.getElementById("file-input");
const fileDropdown = document.getElementById("file-dropdown");

const searchFiles = debounce(async (query) => {
    if (!repoPath || query.length < 1) {
        fileDropdown.style.display = "none";
        return;
    }

    const data = await api("/api/files", { path: repoPath, query });
    const filtered = data.files.filter((f) => !selectedFiles.includes(f));

    if (filtered.length === 0) {
        fileDropdown.style.display = "none";
        return;
    }

    fileDropdown.innerHTML = filtered
        .map((f) => {
            const highlighted = highlightMatch(f, query);
            return `<div class="dropdown-item" onmousedown="addFile('${escapeHtml(f)}')">${highlighted}</div>`;
        })
        .join("");
    fileDropdown.style.display = "block";
}, 300);

fileInput.addEventListener("input", (e) => searchFiles(e.target.value));
fileInput.addEventListener("focus", (e) => {
    if (e.target.value) searchFiles(e.target.value);
});
fileInput.addEventListener("blur", () => {
    setTimeout(() => (fileDropdown.style.display = "none"), 150);
});
fileInput.addEventListener("keydown", (e) => {
    if (e.key === "Escape") fileDropdown.style.display = "none";
});

function addFile(filename) {
    if (selectedFiles.includes(filename)) return;
    selectedFiles.push(filename);
    fileInput.value = "";
    fileDropdown.style.display = "none";
    renderChips();
}

function removeFile(filename) {
    selectedFiles = selectedFiles.filter((f) => f !== filename);
    renderChips();
}

function renderChips() {
    const container = document.getElementById("file-chips");
    container.innerHTML = selectedFiles
        .map(
            (f) =>
                `<span class="chip">${escapeHtml(f)}<button onclick="removeFile('${escapeHtml(f)}')">&times;</button></span>`
        )
        .join("");
}

function highlightMatch(text, query) {
    const idx = text.toLowerCase().indexOf(query.toLowerCase());
    if (idx === -1) return escapeHtml(text);
    const before = escapeHtml(text.slice(0, idx));
    const match = escapeHtml(text.slice(idx, idx + query.length));
    const after = escapeHtml(text.slice(idx + query.length));
    return `${before}<strong>${match}</strong>${after}`;
}

function escapeHtml(str) {
    const div = document.createElement("div");
    div.textContent = str;
    return div.innerHTML;
}

// --- Search ---

async function executeSearch() {
    const startDate = document.getElementById("start-date").value;
    const endDate = document.getElementById("end-date").value;
    const btn = document.getElementById("search-btn");
    const resultsSection = document.getElementById("results-section");
    const resultsList = document.getElementById("results-list");
    const heading = document.getElementById("results-heading");

    if (selectedFiles.length === 0) {
        alert("Please select at least one file.");
        return;
    }
    if (!startDate || !endDate) {
        alert("Please select both start and end dates.");
        return;
    }
    if (startDate > endDate) {
        alert("Start date must be before end date.");
        return;
    }

    btn.disabled = true;
    btn.textContent = "Searching...";
    resultsList.innerHTML = '<div class="loading">Searching commits...</div>';
    resultsSection.style.display = "";

    const data = await api("/api/search", {
        path: repoPath,
        files: selectedFiles,
        startDate,
        endDate,
    });

    searchResults = data.commits || [];

    if (searchResults.length === 0) {
        heading.textContent = "No commits found";
        resultsList.innerHTML =
            '<p class="empty-state">No commits matched your criteria. Try widening the date range or selecting different files.</p>';
    } else {
        const label = data.truncated ? "200+ commits found (showing first 200)" : `${searchResults.length} commit${searchResults.length === 1 ? "" : "s"} found`;
        heading.textContent = label;
        resultsList.innerHTML = searchResults
            .map(
                (c, i) => `
                <div class="commit-row" onclick="showCommitDetail(${i})">
                    <span class="commit-hash">${c.hash.slice(0, 8)}</span>
                    <span class="commit-message">${escapeHtml(c.message)}</span>
                    <span class="commit-meta">
                        <span class="commit-author">${escapeHtml(c.author)}</span>
                        <span class="commit-date">${formatDate(c.date)}</span>
                    </span>
                </div>`
            )
            .join("");
    }

    btn.disabled = false;
    btn.textContent = "Search Commits";
}

function formatDate(isoDate) {
    const d = new Date(isoDate);
    return d.toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
    });
}

// --- Commit Detail ---

async function showCommitDetail(index) {
    const commit = searchResults[index];
    if (!commit) return;

    document.getElementById("search-view").style.display = "none";
    document.getElementById("detail-view").style.display = "";

    document.getElementById("detail-message").textContent = commit.message;
    document.getElementById("detail-hash").textContent = commit.hash;
    document.getElementById("detail-author").textContent = commit.author;
    document.getElementById("detail-date").textContent = formatDate(commit.date);

    // GitHub link
    const ghLink = document.getElementById("detail-github-link");
    if (githubBaseUrl) {
        ghLink.href = `${githubBaseUrl}/commit/${commit.hash}`;
        ghLink.style.display = "";
    } else {
        ghLink.style.display = "none";
    }

    // Load diff
    const diffContainer = document.getElementById("detail-diff");
    diffContainer.innerHTML = '<div class="loading">Loading diff...</div>';

    const data = await api("/api/diff", {
        path: repoPath,
        hash: commit.hash,
        files: selectedFiles,
    });

    currentDiffText = data.diff || "";

    if (!currentDiffText) {
        diffContainer.innerHTML = '<p class="empty-state">No diff available for this commit.</p>';
        return;
    }

    renderDiff();
}

function renderDiff() {
    const diffContainer = document.getElementById("detail-diff");
    if (!currentDiffText) return;

    const targetElement = document.createElement("div");
    diffContainer.innerHTML = "";
    diffContainer.appendChild(targetElement);

    const diff2htmlUi = new Diff2HtmlUI(targetElement, currentDiffText, {
        drawFileList: true,
        matching: "lines",
        outputFormat: currentDiffMode,
        highlight: true,
    });
    diff2htmlUi.draw();
    diff2htmlUi.highlightCode();
}

function switchDiffMode(mode, btn) {
    currentDiffMode = mode;
    document.querySelectorAll(".toggle-btn").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    renderDiff();
}

function showSearchView() {
    document.getElementById("detail-view").style.display = "none";
    document.getElementById("search-view").style.display = "";
}
