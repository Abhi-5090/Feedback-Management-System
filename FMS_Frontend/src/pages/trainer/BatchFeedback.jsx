import { useParams } from 'react-router-dom';
import { useCallback } from 'react';
import { AnalyticsAPI } from '../../api/endpoints.js';
import BatchFeedbackView from '../../components/BatchFeedbackView.jsx';

export default function TrainerBatchFeedback() {
  const { batchId } = useParams();
  /* Takes the params the view supplies — { round } when a collection is
     selected — so switching weeks refetches through the same path rather than
     needing its own request plumbing. */
  const fetcher = useCallback((params) => AnalyticsAPI.batch(batchId, params), [batchId]);
  return (
    <BatchFeedbackView
      fetcher={fetcher}
      // What to load. The view keys its effect on this, so changing the id
      // refetches while an unstable fetcher identity cannot loop.
      reloadKey={batchId}
      exportPath={`/export/batch/${batchId}`}
      exportName="batch_feedback"
      backTo="/trainer/feedbacks"
      basePath="/trainer"
    />
  );
}
