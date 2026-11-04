(function attachDashboardData(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.JobCrestDashboardData = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function dashboardDataFactory() {
  "use strict";

  function groups(payload, key) {
    const value = payload?.[key];
    return Array.isArray(value)
      ? value.map((item) => ({ label: String(item?.label || "Other"), count: Math.max(0, Number(item?.count) || 0), value: Number(item?.value) || 0 }))
      : [];
  }

  function stageGroups(payload, statuses = []) {
    const counts = payload?.stageLeadCounts && typeof payload.stageLeadCounts === "object" ? payload.stageLeadCounts : {};
    const values = payload?.stageValues && typeof payload.stageValues === "object" ? payload.stageValues : {};
    return statuses.map((status) => ({ status, count: Number(counts[status]) || 0, value: Number(values[status]) || 0 }));
  }

  function revenueMonths(payload, now = new Date()) {
    const source = payload?.revenueMonths && typeof payload.revenueMonths === "object" ? payload.revenueMonths : {};
    return Array.from({ length: 6 }, (_, index) => {
      const date = new Date(now.getFullYear(), now.getMonth() - (5 - index), 1);
      const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
      return {
        label: date.toLocaleString("en-US", { month: "short" }),
        year: date.getFullYear(), month: date.getMonth(), value: Number(source[key]) || 0,
      };
    });
  }

  return { groups, stageGroups, revenueMonths };
});
