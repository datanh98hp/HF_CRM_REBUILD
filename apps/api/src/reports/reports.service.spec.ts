import { describe, expect, it } from '@jest/globals';
import {
  assignmentAt,
  disbursementWithinScope,
  getReportPeriodBounds,
  resolveReportSelection,
} from './reports.service.js';
import { ReportPeriod } from './reports.dto.js';

describe('getReportPeriodBounds', () => {
  const now = new Date('2026-11-25T04:20:00.000Z');

  it('uses Asia/Ho_Chi_Minh midnight and an exclusive end for a day', () => {
    const bounds = getReportPeriodBounds(ReportPeriod.DAY, -1, now);
    expect(bounds.start.toISOString()).toBe('2026-11-23T17:00:00.000Z');
    expect(bounds.endExclusive.toISOString()).toBe('2026-11-24T17:00:00.000Z');
  });

  describe('report access filters', () => {
    const branches = [{ id: 'branch-a', name: 'Chi nhánh A' }];
    const advisers = [{ id: 'adviser-a', name: 'Tư vấn A' }];

    it('rejects branch and adviser selections outside the actor option lists', () => {
      expect(() => resolveReportSelection({ branchId: 'branch-b' }, branches, advisers))
        .toThrow(expect.objectContaining({ response: { code: 'REPORT_BRANCH_SCOPE_DENIED' } }));
      expect(() => resolveReportSelection({ adviserId: 'adviser-b' }, branches, advisers))
        .toThrow(expect.objectContaining({ response: { code: 'REPORT_ADVISER_SCOPE_DENIED' } }));
    });

    it('accepts only selections within the authorized options', () => {
      expect(resolveReportSelection({ branchId: 'branch-a', adviserId: 'adviser-a' }, branches, advisers))
        .toEqual({ branchId: 'branch-a', adviserId: 'adviser-a' });
    });
  });

  describe('assignmentAt', () => {
    const eventTime = new Date('2026-11-25T10:00:00.000Z');
    const assignment = (id: string, adviserId: string, assignedAt: string, endedAt: string | null, isPrimary = true) => ({
      id,
      adviserId,
      branchId: 'branch-a',
      isPrimary,
      assignedAt: new Date(assignedAt),
      endedAt: endedAt ? new Date(endedAt) : null,
      adviser: { displayName: adviserId },
    });

    it('attributes the event to the latest primary assignment active at that time', () => {
      const owner = assignmentAt([
        assignment('old', 'adviser-old', '2026-11-01T00:00:00.000Z', '2026-11-25T09:00:00.000Z'),
        assignment('current', 'adviser-current', '2026-11-25T09:00:00.000Z', null),
        assignment('secondary', 'adviser-secondary', '2026-11-25T09:30:00.000Z', null, false),
      ], eventTime);

      expect(owner?.adviserId).toBe('adviser-current');
    });

    it('treats endedAt as exclusive and returns null when no assignment owns the event', () => {
      const owner = assignmentAt([
        assignment('ended', 'adviser-old', '2026-11-01T00:00:00.000Z', eventTime.toISOString()),
      ], eventTime);

      expect(owner).toBeNull();
    });
  });

  describe('disbursementWithinScope', () => {
    const owner = {
      id: 'assignment',
      adviserId: 'adviser-a',
      branchId: 'branch-a',
      isPrimary: true,
      assignedAt: new Date('2026-11-01T00:00:00.000Z'),
      endedAt: null,
      adviser: { displayName: 'Tư vấn A' },
    };

    it('limits advisers to their own historical ownership and managers to authorized branches', () => {
      expect(disbursementWithinScope('adviser-a', {
        all: false, branchIds: [], ownAll: false, ownBranchIds: [],
        assignedAll: false, assignedBranchIds: ['branch-a'],
      }, {}, owner)).toBe(true);
      expect(disbursementWithinScope('adviser-b', {
        all: false, branchIds: [], ownAll: false, ownBranchIds: [],
        assignedAll: false, assignedBranchIds: ['branch-a'],
      }, {}, owner)).toBe(false);
      expect(disbursementWithinScope('manager', {
        all: false, branchIds: ['branch-a'], ownAll: false, ownBranchIds: [],
        assignedAll: false, assignedBranchIds: [],
      }, {}, owner)).toBe(true);
    });

    it('intersects selected filters with authorization scope', () => {
      const branchScope = {
        all: false, branchIds: ['branch-a'], ownAll: false, ownBranchIds: [],
        assignedAll: false, assignedBranchIds: [],
      };
      expect(disbursementWithinScope('manager', branchScope, { branchId: 'branch-b' }, owner)).toBe(false);
      expect(disbursementWithinScope('manager', branchScope, { adviserId: 'adviser-b' }, owner)).toBe(false);
      expect(disbursementWithinScope('admin', {
        all: true, branchIds: [], ownAll: false, ownBranchIds: [],
        assignedAll: false, assignedBranchIds: [],
      }, { adviserId: 'adviser-a' }, owner)).toBe(true);
    });
  });

  it('starts weeks on Monday in the business timezone', () => {
    const bounds = getReportPeriodBounds(ReportPeriod.WEEK, 0, now);
    expect(bounds.start.toISOString()).toBe('2026-11-22T17:00:00.000Z');
    expect(bounds.endExclusive.toISOString()).toBe('2026-11-29T17:00:00.000Z');
  });

  it('handles month, quarter, and year boundaries across UTC dates', () => {
    const month = getReportPeriodBounds(ReportPeriod.MONTH, 0, now);
    expect(month.start.toISOString()).toBe('2026-10-31T17:00:00.000Z');
    expect(month.endExclusive.toISOString()).toBe('2026-11-30T17:00:00.000Z');

    const quarter = getReportPeriodBounds(ReportPeriod.QUARTER, 0, now);
    expect(quarter.start.toISOString()).toBe('2026-09-30T17:00:00.000Z');
    expect(quarter.endExclusive.toISOString()).toBe('2026-12-31T17:00:00.000Z');

    const year = getReportPeriodBounds(ReportPeriod.YEAR, -1, now);
    expect(year.start.toISOString()).toBe('2024-12-31T17:00:00.000Z');
    expect(year.endExclusive.toISOString()).toBe('2025-12-31T17:00:00.000Z');
  });
});
