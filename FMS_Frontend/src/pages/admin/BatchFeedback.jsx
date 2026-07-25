import { useParams } from 'react-router-dom';
import { useCallback } from 'react';
import { AnalyticsAPI } from '../../api/endpoints.js';
import BatchFeedbackView from '../../components/BatchFeedbackView.jsx';

export default function AdminBatchFeedback() {
  const { batchId } = useParams();
  const fetcher = useCallback(() => AnalyticsAPI.batch(batchId), [batchId]);
  return (
    <BatchFeedbackView
      fetcher={fetcher}
      exportPath={`/export/batch/${batchId}`}
      exportName="batch_feedback"
      backTo="/admin/batches"
      basePath="/admin"
    />
  );
}
