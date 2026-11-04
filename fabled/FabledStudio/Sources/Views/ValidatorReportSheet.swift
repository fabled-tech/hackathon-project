import SwiftUI

// MARK: - Pre-Import Validator Report Sheet (Feature 17)

struct ValidatorReportSheet: View {
    @ObservedObject var viewModel: FabledStudioViewModel
    @Environment(\.dismiss) private var dismiss

    @State private var selectedFilter: ReportFilter = .all

    enum ReportFilter: String, CaseIterable, Identifiable {
        case all = "All Checks"
        case flagged = "Flagged Only"
        case passed = "Passed"

        var id: String { rawValue }
    }

    var body: some View {
        VStack(spacing: 0) {
            headerBar
            Divider().background(FabledTheme.line)
            filterBar
            Divider().background(FabledTheme.line)

            ScrollView {
                VStack(alignment: .leading, spacing: 14) {
                    summaryCard

                    let checks = filteredChecks
                    if checks.isEmpty {
                        Text("No checks match the active filter.")
                            .font(.system(size: 12))
                            .foregroundStyle(FabledTheme.muted)
                            .frame(maxWidth: .infinity, alignment: .center)
                            .padding(.vertical, 32)
                    } else {
                        ForEach(groupedChecks(checks: checks), id: \.groupName) { group in
                            VStack(alignment: .leading, spacing: 6) {
                                HStack {
                                    Text(group.groupName.uppercased())
                                        .font(.system(size: 10, weight: .bold, design: .monospaced))
                                        .foregroundStyle(viewModel.accentColor)
                                    Spacer()
                                    Text("\(group.checks.count) check\(group.checks.count == 1 ? "" : "s")")
                                        .font(.system(size: 9.5, design: .monospaced))
                                        .foregroundStyle(FabledTheme.muted)
                                }
                                .padding(.horizontal, 4)

                                ForEach(group.checks) { check in
                                    checkRow(check)
                                }
                            }
                        }
                    }
                }
                .padding(16)
            }
        }
        .frame(minWidth: 620, idealWidth: 720, minHeight: 480, idealHeight: 640)
        .background(FabledTheme.voidBg)
    }

    // MARK: - Header Bar

    private var headerBar: some View {
        HStack {
            VStack(alignment: .leading, spacing: 2) {
                HStack(spacing: 8) {
                    Text("Pre-Import QA Validator")
                        .font(.system(size: 15, weight: .semibold))
                        .foregroundStyle(FabledTheme.dark)

                    statusBadge
                }
                Text("Schema 0.2.0 · 16 core checks against studio ingestion rules")
                    .font(.system(size: 11))
                    .foregroundStyle(FabledTheme.muted)
            }

            Spacer()

            Button("Done") {
                dismiss()
            }
            .buttonStyle(.plain)
            .font(.system(size: 12, weight: .medium))
            .padding(.horizontal, 12)
            .padding(.vertical, 5)
            .background(FabledTheme.elevated)
            .foregroundStyle(FabledTheme.dark)
            .clipShape(RoundedRectangle(cornerRadius: 6))
            .overlay(RoundedRectangle(cornerRadius: 6).stroke(FabledTheme.line, lineWidth: 1))
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 12)
        .background(FabledTheme.card)
    }

    private var statusBadge: some View {
        let status = viewModel.fullValidatorReport?.overall_status ?? viewModel.validatorOverallStatus
        let color: Color = {
            switch status.lowercased() {
            case "pass": return FabledTheme.green
            case "warn": return FabledTheme.amber
            case "fail": return FabledTheme.red
            default:     return FabledTheme.muted
            }
        }()

        return Text(status.uppercased())
            .font(.system(size: 10, weight: .bold, design: .monospaced))
            .padding(.horizontal, 7)
            .padding(.vertical, 2.5)
            .background(color.opacity(0.18))
            .foregroundStyle(color)
            .clipShape(RoundedRectangle(cornerRadius: 4))
            .overlay(RoundedRectangle(cornerRadius: 4).stroke(color.opacity(0.4), lineWidth: 1))
    }

    // MARK: - Filter Bar

    private var filterBar: some View {
        HStack {
            Picker("Filter", selection: $selectedFilter) {
                ForEach(ReportFilter.allCases) { filter in
                    Text(filter.rawValue).tag(filter)
                }
            }
            .pickerStyle(.segmented)
            .frame(maxWidth: 320)

            Spacer()

            Button {
                Task { await viewModel.runPreImportChecks() }
            } label: {
                HStack(spacing: 4) {
                    Text("Re-run Validator")
                }
                .font(.system(size: 11, weight: .medium))
                .padding(.horizontal, 10)
                .padding(.vertical, 4)
                .background(viewModel.accentColor.opacity(0.2))
                .foregroundStyle(viewModel.accentColor)
                .clipShape(RoundedRectangle(cornerRadius: 5))
            }
            .buttonStyle(.plain)
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 8)
        .background(FabledTheme.card)
    }

    // MARK: - Summary Card

    private var summaryCard: some View {
        let sum = viewModel.fullValidatorReport?.summary ?? ValidatorSummary(
            pass: viewModel.validatorChecks.filter { $0.passed == true }.count,
            warn: viewModel.validatorChecks.filter { $0.severity == .warning }.count,
            fail: viewModel.validatorChecks.filter { $0.severity == .error }.count,
            not_checked: viewModel.validatorChecks.filter { $0.severity == .notChecked }.count,
            total: viewModel.validatorChecks.count,
            flagged: viewModel.validatorChecks.filter { $0.severity == .warning || $0.severity == .error }.count
        )

        return HStack(spacing: 12) {
            summaryMetricItem(label: "Passed", count: sum.pass, color: FabledTheme.green)
            summaryMetricItem(label: "Warnings", count: sum.warn, color: FabledTheme.amber)
            summaryMetricItem(label: "Failures", count: sum.fail, color: FabledTheme.red)
            summaryMetricItem(label: "Not Checked", count: sum.not_checked, color: FabledTheme.muted)
            Spacer()
            VStack(alignment: .trailing, spacing: 2) {
                Text("\(sum.total) Total Checks")
                    .font(.system(size: 11.5, weight: .semibold, design: .monospaced))
                    .foregroundStyle(FabledTheme.dark)
                Text(sum.flagged == 0 ? "All passing" : "\(sum.flagged) flagged")
                    .font(.system(size: 10.5, design: .monospaced))
                    .foregroundStyle(sum.flagged == 0 ? FabledTheme.green : FabledTheme.amber)
            }
        }
        .padding(12)
        .background(FabledTheme.card)
        .clipShape(RoundedRectangle(cornerRadius: 8))
        .overlay(RoundedRectangle(cornerRadius: 8).stroke(FabledTheme.line, lineWidth: 1))
    }

    private func summaryMetricItem(label: String, count: Int, color: Color) -> some View {
        HStack(spacing: 6) {
            Circle()
                .fill(color)
                .frame(width: 8, height: 8)
            VStack(alignment: .leading, spacing: 0) {
                Text("\(count)")
                    .font(.system(size: 13, weight: .bold, design: .monospaced))
                    .foregroundStyle(color)
                Text(label)
                    .font(.system(size: 9.5))
                    .foregroundStyle(FabledTheme.muted)
            }
        }
        .padding(.horizontal, 8)
        .padding(.vertical, 4)
        .background(FabledTheme.elevated)
        .clipShape(RoundedRectangle(cornerRadius: 6))
    }

    // MARK: - Check Row

    private func checkRow(_ check: ValidatorCheck) -> some View {
        let statusColor: Color = {
            if check.isPass { return FabledTheme.green }
            if check.isWarn { return FabledTheme.amber }
            if check.isFail { return FabledTheme.red }
            return FabledTheme.muted
        }()

        return VStack(alignment: .leading, spacing: 6) {
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                Text(check.statusGlyph)
                    .font(.system(size: 11, weight: .bold, design: .monospaced))
                    .foregroundStyle(statusColor)
                    .frame(width: 14)

                Text(check.displayTitle)
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(FabledTheme.dark)

                Text("(\(check.id))")
                    .font(.system(size: 10, design: .monospaced))
                    .foregroundStyle(FabledTheme.muted)

                Spacer()

                Text(check.status.uppercased())
                    .font(.system(size: 9, weight: .bold, design: .monospaced))
                    .padding(.horizontal, 5)
                    .padding(.vertical, 1.5)
                    .background(statusColor.opacity(0.18))
                    .foregroundStyle(statusColor)
                    .clipShape(RoundedRectangle(cornerRadius: 3))
            }

            Text(check.message)
                .font(.system(size: 11))
                .foregroundStyle(FabledTheme.muted)
                .padding(.leading, 22)

            if let hint = check.fix_hint, !hint.isEmpty {
                HStack(alignment: .top, spacing: 4) {
                    Text("Fix hint:")
                        .font(.system(size: 10, weight: .semibold))
                        .foregroundStyle(FabledTheme.amber)
                    Text(hint)
                        .font(.system(size: 10))
                        .foregroundStyle(FabledTheme.muted)
                }
                .padding(.leading, 22)
            }

            // One-Click Fix Triggers (Feature 17)
            if check.id == "scale" && (check.isWarn || check.isFail) {
                HStack {
                    Spacer()
                    Button("Apply 0.01× Scale Fix (cm in meters)") {
                        viewModel.applyScaleFix(0.01)
                    }
                    .buttonStyle(.plain)
                    .font(.system(size: 10.5, weight: .semibold))
                    .padding(.horizontal, 8)
                    .padding(.vertical, 3.5)
                    .background(viewModel.accentColor)
                    .foregroundStyle(Color.white)
                    .clipShape(RoundedRectangle(cornerRadius: 4))
                }
                .padding(.leading, 22)
            } else if check.id == "normals" && (check.isWarn || check.isFail) {
                HStack {
                    Spacer()
                    Button("Unify Triangle Winding") {
                        Task { await viewModel.applyUnifiedWindingFix() }
                    }
                    .buttonStyle(.plain)
                    .font(.system(size: 10.5, weight: .semibold))
                    .padding(.horizontal, 8)
                    .padding(.vertical, 3.5)
                    .background(viewModel.accentColor)
                    .foregroundStyle(Color.white)
                    .clipShape(RoundedRectangle(cornerRadius: 4))
                }
                .padding(.leading, 22)
            }
        }
        .padding(10)
        .background(FabledTheme.card)
        .clipShape(RoundedRectangle(cornerRadius: 7))
        .overlay(
            RoundedRectangle(cornerRadius: 7)
                .stroke(check.isWarn || check.isFail ? statusColor.opacity(0.35) : FabledTheme.line, lineWidth: 1)
        )
    }

    // MARK: - Helpers

    private var allChecks: [ValidatorCheck] {
        if let report = viewModel.fullValidatorReport {
            return report.checks
        }
        return viewModel.validatorChecks.map { item in
            ValidatorCheck(
                id: item.id,
                group: nil,
                title: item.id,
                status: item.severity == .pass ? "pass" : (item.severity == .warning ? "warn" : (item.severity == .error ? "fail" : "not_checked")),
                message: item.message,
                fix_hint: item.fixHint
            )
        }
    }

    private var filteredChecks: [ValidatorCheck] {
        switch selectedFilter {
        case .all:
            return allChecks
        case .flagged:
            return allChecks.filter { $0.isWarn || $0.isFail }
        case .passed:
            return allChecks.filter { $0.isPass }
        }
    }

    private struct CheckGroup {
        let groupName: String
        let checks: [ValidatorCheck]
    }

    private func groupedChecks(checks: [ValidatorCheck]) -> [CheckGroup] {
        var groups: [String: [ValidatorCheck]] = [:]
        var groupOrder: [String] = []

        for check in checks {
            let grp = check.group ?? StandardValidatorCheckID(rawValue: check.id)?.groupTitle ?? "General QA Checks"
            if groups[grp] == nil {
                groupOrder.append(grp)
                groups[grp] = []
            }
            groups[grp]?.append(check)
        }

        return groupOrder.compactMap { name in
            guard let items = groups[name] else { return nil }
            return CheckGroup(groupName: name, checks: items)
        }
    }
}
