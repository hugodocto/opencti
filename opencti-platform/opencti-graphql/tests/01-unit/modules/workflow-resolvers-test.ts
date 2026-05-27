import { describe, expect, it, vi, beforeEach } from 'vitest';
import workflowResolvers from '../../../src/modules/workflow/api/workflow-resolvers';
import {
  getAllowedTransitions,
  triggerWorkflowEvent,
  retryPendingWorkflowTransitionActions,
  clearWorkflowPendingState,
  getWorkflowInstance,
} from '../../../src/modules/workflow/domain/workflow-domain';
import { reportWorkflowAsyncActionResult } from '../../../src/modules/workflow/domain/workflow-async-completion';

vi.mock('../../../src/modules/workflow/domain/workflow-domain', () => ({
  getWorkflowDefinition: vi.fn(),
  getWorkflowInstance: vi.fn(),
  getAllowedTransitions: vi.fn(),
  setWorkflowDefinition: vi.fn(),
  deleteWorkflowDefinition: vi.fn(),
  triggerWorkflowEvent: vi.fn(),
  retryPendingWorkflowTransitionActions: vi.fn(),
  clearWorkflowPendingState: vi.fn(),
}));

vi.mock('../../../src/modules/workflow/domain/workflow-async-completion', () => ({
  reportWorkflowAsyncActionResult: vi.fn(),
}));

const mockContext = { user: { id: 'user-id' } } as any;

beforeEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// WorkflowTransition field resolver
// ---------------------------------------------------------------------------

describe('WorkflowTransition resolver – comment field', () => {
  it('should return the comment when it is defined on the transition', () => {
    const transition = { event: 'review', toState: 'reviewed', comment: 'Requires approval', actions: [] };
    const result = workflowResolvers.WorkflowTransition.comment(transition);
    expect(result).toBe('Requires approval');
  });

  it('should return null when comment is undefined on the transition', () => {
    const transition = { event: 'review', toState: 'reviewed', actions: [] };
    const result = workflowResolvers.WorkflowTransition.comment(transition);
    expect(result).toBeNull();
  });

  it('should return null when comment is explicitly null on the transition', () => {
    const transition = { event: 'review', toState: 'reviewed', comment: null, actions: [] };
    const result = workflowResolvers.WorkflowTransition.comment(transition);
    expect(result).toBeNull();
  });

  it('should return an empty string when comment is an empty string', () => {
    const transition = { event: 'review', toState: 'reviewed', comment: '', actions: [] };
    const result = workflowResolvers.WorkflowTransition.comment(transition);
    // empty string is falsy – ?? keeps it as empty string (not null)
    expect(result).toBe('');
  });
});

// ---------------------------------------------------------------------------
// WorkflowInstance.lastHistoryEntry – comment in history
// ---------------------------------------------------------------------------

describe('WorkflowInstance resolver – lastHistoryEntry comment', () => {
  it('should return the most recent history entry, including its comment', () => {
    const instance = {
      id: 'inst-1',
      currentState: 'reviewed',
      allowedTransitions: [],
      history: [
        { state: 'draft', event: 'init', user_id: 'u1', timestamp: '2024-01-01T00:00:00Z' },
        { state: 'reviewed', event: 'review', user_id: 'u1', timestamp: '2024-01-02T00:00:00Z', comment: 'Looks good' },
      ],
    };

    const entry = workflowResolvers.WorkflowInstance.lastHistoryEntry(instance);
    expect(entry).not.toBeNull();
    expect(entry!.comment).toBe('Looks good');
    expect(entry!.event).toBe('review');
  });

  it('should return null when lastHistoryEntry has no comment', () => {
    const instance = {
      id: 'inst-1',
      currentState: 'draft',
      allowedTransitions: [],
      history: [
        { state: 'draft', event: 'init', user_id: 'u1', timestamp: '2024-01-01T00:00:00Z' },
      ],
    };

    const entry = workflowResolvers.WorkflowInstance.lastHistoryEntry(instance);
    expect(entry).not.toBeNull();
    expect(entry!.comment).toBeUndefined();
  });

  it('should return null when history is empty', () => {
    const instance = { id: 'inst-1', currentState: 'draft', allowedTransitions: [], history: [] };
    const entry = workflowResolvers.WorkflowInstance.lastHistoryEntry(instance);
    expect(entry).toBeNull();
  });

  it('should return null when history is undefined', () => {
    const instance = { id: 'inst-1', currentState: 'draft', allowedTransitions: [] };
    const entry = workflowResolvers.WorkflowInstance.lastHistoryEntry(instance);
    expect(entry).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Mutation.triggerWorkflowEvent – comment forwarding
// ---------------------------------------------------------------------------

describe('Mutation.triggerWorkflowEvent resolver – comment forwarding', () => {
  it('should forward the comment to the domain function when provided', async () => {
    (triggerWorkflowEvent as any).mockResolvedValue({ success: true, newState: 'reviewed', instance: {}, entity: {} });

    await workflowResolvers.Mutation.triggerWorkflowEvent(
      {},
      { entityId: 'entity-id', eventName: 'review', comment: 'Approved for review' },
      mockContext,
    );

    expect(triggerWorkflowEvent).toHaveBeenCalledWith(
      mockContext,
      mockContext.user,
      'entity-id',
      'review',
      'Approved for review',
      {},
    );
  });

  it('should forward undefined comment to the domain function when no comment is provided', async () => {
    (triggerWorkflowEvent as any).mockResolvedValue({ success: true, newState: 'reviewed', instance: {}, entity: {} });

    await workflowResolvers.Mutation.triggerWorkflowEvent(
      {},
      { entityId: 'entity-id', eventName: 'review' },
      mockContext,
    );

    expect(triggerWorkflowEvent).toHaveBeenCalledWith(
      mockContext,
      mockContext.user,
      'entity-id',
      'review',
      undefined,
      {},
    );
  });
});

// ---------------------------------------------------------------------------
// Query.allowedTransitions – comment exposed through resolver
// ---------------------------------------------------------------------------

describe('Query.allowedTransitions resolver – comment field', () => {
  it('should return transitions that include the comment field', async () => {
    (getAllowedTransitions as any).mockResolvedValue([
      { event: 'review', toState: 'reviewed', comment: 'Requires manager sign-off', actions: [] },
      { event: 'reject', toState: 'rejected', actions: [] },
    ]);

    const result = await workflowResolvers.Query.allowedTransitions({}, { entityId: 'entity-id' }, mockContext);

    expect(result).toHaveLength(2);
    expect(result[0].comment).toBe('Requires manager sign-off');
    expect(result[1].comment).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// WorkflowTriggerResult resolver – status from newState
// ---------------------------------------------------------------------------

describe('WorkflowTriggerResult resolver – status field', () => {
  it('should return a status object derived from newState when present', () => {
    const triggerResult = { newState: 'reviewed', instance: {}, entity: {} };
    const status = workflowResolvers.WorkflowTriggerResult.status(triggerResult);
    expect(status).toEqual({ id: 'reviewed', template_id: 'reviewed' });
  });

  it('should return null when newState is absent', () => {
    const triggerResult = { instance: {}, entity: {} };
    const status = workflowResolvers.WorkflowTriggerResult.status(triggerResult);
    expect(status).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Mutation.triggerWorkflowEvent – comment validation and normalization
// ---------------------------------------------------------------------------

describe('Mutation.triggerWorkflowEvent resolver – comment validation', () => {
  it('should throw GraphQLError when comment exceeds 1000 characters', () => {
    const longComment = 'a'.repeat(1001);

    expect(() =>
      workflowResolvers.Mutation.triggerWorkflowEvent(
        {},
        { entityId: 'entity-id', eventName: 'review', comment: longComment },
        mockContext,
      ),
    ).toThrow('Comment exceeds maximum allowed length of 1000 characters.');
  });

  it('should NOT throw when comment is exactly 1000 characters', async () => {
    (triggerWorkflowEvent as any).mockResolvedValue({ success: true, newState: 'reviewed', instance: {}, entity: {} });
    const exactComment = 'a'.repeat(1000);

    await expect(
      workflowResolvers.Mutation.triggerWorkflowEvent(
        {},
        { entityId: 'entity-id', eventName: 'review', comment: exactComment },
        mockContext,
      ),
    ).resolves.not.toThrow();

    expect(triggerWorkflowEvent).toHaveBeenCalledWith(
      mockContext, mockContext.user, 'entity-id', 'review', exactComment, {},
    );
  });

  it('should trim the comment before passing it to the domain', async () => {
    (triggerWorkflowEvent as any).mockResolvedValue({ success: true, newState: 'reviewed', instance: {}, entity: {} });

    await workflowResolvers.Mutation.triggerWorkflowEvent(
      {},
      { entityId: 'entity-id', eventName: 'review', comment: '  trimmed comment  ' },
      mockContext,
    );

    expect(triggerWorkflowEvent).toHaveBeenCalledWith(
      mockContext, mockContext.user, 'entity-id', 'review', 'trimmed comment', {},
    );
  });

  it('should convert null comment to undefined before passing to the domain', async () => {
    (triggerWorkflowEvent as any).mockResolvedValue({ success: true, newState: 'reviewed', instance: {}, entity: {} });

    await workflowResolvers.Mutation.triggerWorkflowEvent(
      {},
      { entityId: 'entity-id', eventName: 'review', comment: null },
      mockContext,
    );

    expect(triggerWorkflowEvent).toHaveBeenCalledWith(
      mockContext, mockContext.user, 'entity-id', 'review', undefined, {},
    );
  });

});

// ---------------------------------------------------------------------------
// Mutation.retryPendingWorkflowTransitionActions
// ---------------------------------------------------------------------------

describe('Mutation.retryPendingWorkflowTransitionActions resolver', () => {
  it('delegates to the domain function with the correct args', async () => {
    (retryPendingWorkflowTransitionActions as any).mockResolvedValue({ success: true, executionStatus: 'pending', instance: {}, entity: {} });

    const result = await workflowResolvers.Mutation.retryPendingWorkflowTransitionActions(
      {},
      { entityId: 'entity-id' },
      mockContext,
    );

    expect(retryPendingWorkflowTransitionActions).toHaveBeenCalledWith(mockContext, mockContext.user, 'entity-id');
    expect(result).toEqual({ success: true, executionStatus: 'pending', instance: {}, entity: {} });
  });
});

// ---------------------------------------------------------------------------
// Mutation.clearWorkflowPendingState
// ---------------------------------------------------------------------------

describe('Mutation.clearWorkflowPendingState resolver', () => {
  it('delegates to the domain function with the correct args', async () => {
    (clearWorkflowPendingState as any).mockResolvedValue({ id: 'inst-id', pendingStatus: null });

    const result = await workflowResolvers.Mutation.clearWorkflowPendingState(
      {},
      { entityId: 'entity-id' },
      mockContext,
    );

    expect(clearWorkflowPendingState).toHaveBeenCalledWith(mockContext, mockContext.user, 'entity-id');
    expect(result).toEqual({ id: 'inst-id', pendingStatus: null });
  });
});

// ---------------------------------------------------------------------------
// Mutation.reportWorkflowAsyncActionResult
// ---------------------------------------------------------------------------

describe('Mutation.reportWorkflowAsyncActionResult resolver', () => {
  it('calls reportWorkflowAsyncActionResult and returns true', async () => {
    (reportWorkflowAsyncActionResult as any).mockResolvedValue(undefined);

    const result = await workflowResolvers.Mutation.reportWorkflowAsyncActionResult(
      {},
      { workflowInstanceId: 'inst-id', workflowActionId: 'slot-id', status: 'success' },
      mockContext,
    );

    expect(reportWorkflowAsyncActionResult).toHaveBeenCalledWith(
      mockContext, mockContext.user, 'inst-id', 'slot-id', 'success', undefined,
    );
    expect(result).toBe(true);
  });

  it('forwards the error message when provided', async () => {
    (reportWorkflowAsyncActionResult as any).mockResolvedValue(undefined);

    await workflowResolvers.Mutation.reportWorkflowAsyncActionResult(
      {},
      { workflowInstanceId: 'inst-id', workflowActionId: 'slot-id', status: 'failed', error: 'task blew up' },
      mockContext,
    );

    expect(reportWorkflowAsyncActionResult).toHaveBeenCalledWith(
      mockContext, mockContext.user, 'inst-id', 'slot-id', 'failed', 'task blew up',
    );
  });
});

// ---------------------------------------------------------------------------
// WorkflowInstance – new pending fields
// ---------------------------------------------------------------------------

describe('WorkflowInstance resolver – pending fields', () => {
  it('returns pendingStatus from the instance', () => {
    expect(workflowResolvers.WorkflowInstance.pendingStatus({ pendingStatus: 'pending' })).toBe('pending');
    expect(workflowResolvers.WorkflowInstance.pendingStatus({ pendingStatus: null })).toBeNull();
    expect(workflowResolvers.WorkflowInstance.pendingStatus({})).toBeNull();
  });

  it('returns pendingError from the instance', () => {
    expect(workflowResolvers.WorkflowInstance.pendingError({ pendingError: 'some error' })).toBe('some error');
    expect(workflowResolvers.WorkflowInstance.pendingError({ pendingError: null })).toBeNull();
    expect(workflowResolvers.WorkflowInstance.pendingError({})).toBeNull();
  });

  it('returns pendingTransition from the instance', () => {
    const pt = { event: 'submit', toState: 'reviewing', triggeredAt: '2024-01-01T00:00:00Z', asyncActions: [] };
    expect(workflowResolvers.WorkflowInstance.pendingTransition({ pendingTransition: pt })).toEqual(pt);
    expect(workflowResolvers.WorkflowInstance.pendingTransition({ pendingTransition: null })).toBeNull();
    expect(workflowResolvers.WorkflowInstance.pendingTransition({})).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// WorkflowTransition – requiresOrganizationInput fields
// ---------------------------------------------------------------------------

describe('WorkflowTransition resolver – org input flags', () => {
  it('returns requiresShareOrganizationInput value or false', () => {
    expect(workflowResolvers.WorkflowTransition.requiresShareOrganizationInput({ requiresShareOrganizationInput: true })).toBe(true);
    expect(workflowResolvers.WorkflowTransition.requiresShareOrganizationInput({ requiresShareOrganizationInput: false })).toBe(false);
    expect(workflowResolvers.WorkflowTransition.requiresShareOrganizationInput({})).toBe(false);
  });

  it('returns requiresUnshareOrganizationInput value or false', () => {
    expect(workflowResolvers.WorkflowTransition.requiresUnshareOrganizationInput({ requiresUnshareOrganizationInput: true })).toBe(true);
    expect(workflowResolvers.WorkflowTransition.requiresUnshareOrganizationInput({})).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// WorkflowPendingAsyncAction – field resolvers
// ---------------------------------------------------------------------------

describe('WorkflowPendingAsyncAction resolver – field resolvers', () => {
  const slot = {
    id: 'slot-1',
    workId: 'work-1',
    type: 'asyncBulkAction',
    status: 'pending',
    processedCount: 10,
    expectedCount: 50,
    startedAt: '2024-01-01T00:00:00Z',
    lastActivityAt: '2024-01-01T01:00:00Z',
    errors: [{ message: 'err' }],
  };

  it('returns all fields from the slot', () => {
    expect(workflowResolvers.WorkflowPendingAsyncAction.id(slot)).toBe('slot-1');
    expect(workflowResolvers.WorkflowPendingAsyncAction.workId(slot)).toBe('work-1');
    expect(workflowResolvers.WorkflowPendingAsyncAction.type(slot)).toBe('asyncBulkAction');
    expect(workflowResolvers.WorkflowPendingAsyncAction.status(slot)).toBe('pending');
    expect(workflowResolvers.WorkflowPendingAsyncAction.processedCount(slot)).toBe(10);
    expect(workflowResolvers.WorkflowPendingAsyncAction.expectedCount(slot)).toBe(50);
    expect(workflowResolvers.WorkflowPendingAsyncAction.startedAt(slot)).toBe('2024-01-01T00:00:00Z');
    expect(workflowResolvers.WorkflowPendingAsyncAction.lastActivityAt(slot)).toBe('2024-01-01T01:00:00Z');
    expect(workflowResolvers.WorkflowPendingAsyncAction.errors(slot)).toEqual([{ message: 'err' }]);
  });

  it('returns null for optional numeric fields when absent', () => {
    expect(workflowResolvers.WorkflowPendingAsyncAction.processedCount({})).toBeNull();
    expect(workflowResolvers.WorkflowPendingAsyncAction.expectedCount({})).toBeNull();
    expect(workflowResolvers.WorkflowPendingAsyncAction.startedAt({})).toBeNull();
    expect(workflowResolvers.WorkflowPendingAsyncAction.lastActivityAt({})).toBeNull();
    expect(workflowResolvers.WorkflowPendingAsyncAction.errors({})).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// WorkflowPendingTransition – field resolvers
// ---------------------------------------------------------------------------

describe('WorkflowPendingTransition resolver – field resolvers', () => {
  const pt = {
    event: 'submit',
    toState: 'reviewing',
    triggeredAt: '2024-01-01T00:00:00Z',
    asyncActions: [{ id: 'slot-1' }],
  };

  it('returns all fields', () => {
    expect(workflowResolvers.WorkflowPendingTransition.event(pt)).toBe('submit');
    expect(workflowResolvers.WorkflowPendingTransition.toState(pt)).toBe('reviewing');
    expect(workflowResolvers.WorkflowPendingTransition.triggeredAt(pt)).toBe('2024-01-01T00:00:00Z');
    expect(workflowResolvers.WorkflowPendingTransition.asyncActions(pt)).toEqual([{ id: 'slot-1' }]);
  });

  it('returns empty array for asyncActions when absent', () => {
    expect(workflowResolvers.WorkflowPendingTransition.asyncActions({})).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// WorkflowTriggerResult – executionStatus and pendingTransition
// ---------------------------------------------------------------------------

describe('WorkflowTriggerResult resolver – executionStatus and pendingTransition', () => {
  it('returns executionStatus when present', () => {
    expect(workflowResolvers.WorkflowTriggerResult.executionStatus({ executionStatus: 'pending' })).toBe('pending');
    expect(workflowResolvers.WorkflowTriggerResult.executionStatus({ executionStatus: 'completed' })).toBe('completed');
    expect(workflowResolvers.WorkflowTriggerResult.executionStatus({})).toBeNull();
  });

  it('returns instance.pendingTransition for pendingTransition field', () => {
    const pt = { event: 'submit', toState: 'reviewing' };
    expect(workflowResolvers.WorkflowTriggerResult.pendingTransition({ instance: { pendingTransition: pt } })).toEqual(pt);
    expect(workflowResolvers.WorkflowTriggerResult.pendingTransition({ instance: null })).toBeNull();
    expect(workflowResolvers.WorkflowTriggerResult.pendingTransition({})).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// DraftWorkspace.workflowInstance
// ---------------------------------------------------------------------------

describe('DraftWorkspace.workflowInstance resolver', () => {
  it('calls getWorkflowInstance with the draft entity id', async () => {
    (getWorkflowInstance as any).mockResolvedValue({ id: 'inst-id', currentState: 'draft' });

    const result = await workflowResolvers.DraftWorkspace.workflowInstance(
      { id: 'draft-id', internal_id: 'draft-id' },
      {},
      mockContext,
    );

    expect(getWorkflowInstance).toHaveBeenCalledWith(mockContext, mockContext.user, 'draft-id');
    expect(result).toEqual({ id: 'inst-id', currentState: 'draft' });
  });

  it('uses internal_id when id is not present', async () => {
    (getWorkflowInstance as any).mockResolvedValue(null);

    await workflowResolvers.DraftWorkspace.workflowInstance(
      { internal_id: 'draft-internal-id' },
      {},
      mockContext,
    );

    expect(getWorkflowInstance).toHaveBeenCalledWith(mockContext, mockContext.user, 'draft-internal-id');
  });
});

