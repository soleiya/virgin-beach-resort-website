// Shared visual cabana map: fetches cabana inventory + per-date availability
// from Supabase and renders a clickable seat-plan-style grid. Used by the
// public booking page (assets/js/booking.js) and, in a simpler read-only
// form, by the staff dashboard.
(function (global) {
  var TYPE_LABELS = {
    dining_cabana: "Dining Cabana",
    lounge_cabana: "Lounge Cabana",
  };

  var FACILITIES = {
    // section -> array of {row_index, col_index, label}
    B: [
      { row_index: 2, col_index: 4, label: "Pool" },
      { row_index: 2, col_index: 5, label: "Pool Bar" },
    ],
    A: [],
  };

  var cabanaCache = null;

  function loadCabanas(sb) {
    if (cabanaCache) return Promise.resolve(cabanaCache);
    return sb
      .from("cabanas")
      .select("*")
      .order("section", { ascending: true })
      .order("row_index", { ascending: true })
      .order("col_index", { ascending: true })
      .then(function (res) {
        if (res.error) throw res.error;
        cabanaCache = res.data || [];
        return cabanaCache;
      });
  }

  // Returns a Set of cabana_id strings that are already held (booked, not
  // declined) for the given YYYY-MM-DD date.
  function loadHolds(sb, dateStr) {
    if (!dateStr) return Promise.resolve(new Set());
    return sb
      .from("public_cabana_holds")
      .select("cabana_id")
      .eq("check_in", dateStr)
      .then(function (res) {
        if (res.error) throw res.error;
        var set = new Set();
        (res.data || []).forEach(function (row) {
          if (row.cabana_id) set.add(row.cabana_id);
        });
        return set;
      });
  }

  function groupBySection(cabanas) {
    var sections = {};
    cabanas.forEach(function (c) {
      sections[c.section] = sections[c.section] || [];
      sections[c.section].push(c);
    });
    return sections;
  }

  function maxRow(list) {
    return list.reduce(function (m, c) {
      return Math.max(m, c.row_index);
    }, 0);
  }
  function maxCol(list) {
    return list.reduce(function (m, c) {
      return Math.max(m, c.col_index);
    }, 0);
  }

  // opts: { cabanas, heldSet, selectedId, onSelect(cabana) }
  function render(container, opts) {
    var cabanas = opts.cabanas || [];
    var heldSet = opts.heldSet || new Set();
    var selectedId = opts.selectedId || null;
    var onSelect = opts.onSelect || function () {};

    var sections = groupBySection(cabanas);
    var order = ["B", "A"]; // left to right, matches the printed layout
    container.innerHTML = "";
    container.classList.add("cabana-map");

    order.forEach(function (sectionKey) {
      var list = sections[sectionKey];
      if (!list || !list.length) return;

      var panel = document.createElement("div");
      panel.className = "cabana-section";

      var heading = document.createElement("h4");
      heading.className = "cabana-section-title";
      heading.textContent = "Section " + sectionKey;
      panel.appendChild(heading);

      var grid = document.createElement("div");
      grid.className = "cabana-grid";
      grid.style.gridTemplateColumns = "repeat(" + (maxCol(list) + 1) + ", 1fr)";

      var rows = maxRow(list) + 1;
      for (var r = 0; r < rows; r++) {
        (function () {
          var rowCabanas = list.filter(function (c) {
            return c.row_index === r;
          });
          rowCabanas.forEach(function (c) {
            var tile = document.createElement("button");
            tile.type = "button";
            var isHeld = heldSet.has(c.id);
            var isSelected = selectedId === c.id;
            tile.className =
              "cabana-tile cabana-" + c.cabana_type + (isHeld ? " is-held" : "") + (isSelected ? " is-selected" : "");
            tile.style.gridColumn = c.col_index + 1;
            tile.style.gridRow = r + 1;
            tile.textContent = c.number;
            tile.title = c.label + (isHeld ? " — already booked for this date" : " — available");
            tile.disabled = isHeld;
            tile.setAttribute("aria-pressed", isSelected ? "true" : "false");
            tile.addEventListener("click", function () {
              onSelect(c);
            });
            grid.appendChild(tile);
          });

          var facilities = FACILITIES[sectionKey] || [];
          facilities
            .filter(function (f) {
              return f.row_index === r;
            })
            .forEach(function (f) {
              var facTile = document.createElement("div");
              facTile.className = "cabana-tile cabana-facility";
              facTile.style.gridColumn = f.col_index + 1;
              facTile.style.gridRow = r + 1;
              facTile.textContent = f.label;
              grid.appendChild(facTile);
            });
        })();
      }

      panel.appendChild(grid);
      container.appendChild(panel);
    });

    var legend = document.createElement("div");
    legend.className = "cabana-legend";
    legend.innerHTML =
      '<span><i class="cabana-swatch cabana-dining_cabana"></i> Dining Cabana</span>' +
      '<span><i class="cabana-swatch cabana-lounge_cabana"></i> Lounge Cabana</span>' +
      '<span><i class="cabana-swatch is-held"></i> Already booked</span>' +
      '<span><i class="cabana-swatch is-selected"></i> Your selection</span>';
    container.appendChild(legend);
  }

  global.VBRCabanaMap = {
    TYPE_LABELS: TYPE_LABELS,
    loadCabanas: loadCabanas,
    loadHolds: loadHolds,
    render: render,
  };
})(window);
