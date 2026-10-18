// ============================================================================
// Nexora — Automatic Organization & Proposals Page
// Intelligent file organization based on Filename, Metadata, and Face recognition
// ============================================================================

import React, { useState, useEffect } from 'react';
import { api } from '../services/api';
import { toast } from '../store';
import type { OrganizationProposalItem, OrganizationRule } from '@shared/types';

function formatSize(bytes: number): string {
  if (!bytes || bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${units[i]}`;
}

export const OrganizePage: React.FC = () => {
  const [proposals, setProposals] = useState<OrganizationProposalItem[]>([]);
  const [rules, setRules] = useState<OrganizationRule[]>([]);
  const [loading, setLoading] = useState(true);
  const [executing, setExecuting] = useState(false);
  const [runningPipeline, setRunningPipeline] = useState(false);
  const [destinationRoot, setDestinationRoot] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [filterQuery, setFilterQuery] = useState('');
  const [isGeneratingLlmProposals, setIsGeneratingLlmProposals] = useState(false);

  useEffect(() => {
    loadData();
  }, []);

  async function loadData() {
    setLoading(true);
    try {
      const [storedRules, storedProposals, managedPath] = await Promise.all([
        api().organizer.getRules(),
        api().organizer.getStoredProposals('proposed', 300),
        api().settings.get('managedLibraryPath'),
      ]);

      setRules(storedRules || []);
      setProposals(storedProposals || []);
      if (managedPath && typeof managedPath === 'string') {
        setDestinationRoot(managedPath);
      }
    } catch (err) {
      console.error('Failed to load organization proposals:', err);
    } finally {
      setLoading(false);
    }
  }

  async function handleGenerateLlmProposals() {
    if (proposals.length === 0) {
      toast.info('No pending proposals to enhance. Run Recalculate Proposals first.', 'Notice');
      return;
    }
    setIsGeneratingLlmProposals(true);
    try {
      toast.info('Consulting local LLM (Qwen3 4B via Ollama) for smart folder hierarchies...', 'LLM Advisor');
      const targetItems = proposals.slice(0, 5); // Limit batch to 5 for responsive interactive feedback
      let enhancedCount = 0;

      const updatedProposals = [...proposals];
      for (let i = 0; i < targetItems.length; i++) {
        const item = targetItems[i];
        const filename = item.source_path.split(/[\\/]/).pop() || 'file';
        const ext = '.' + (filename.split('.').pop() || '');

        try {
          const rec = await api().llm.recommendOrganization({
            filename,
            extension: ext,
            metadataSnapshot: item.metadata_snapshot,
            availableRules: rules.map((r) => r.name),
          });

          // Validate trusted destination prefix
          if (rec.relativeFolder && !rec.relativeFolder.includes('..')) {
            const destRoot = destinationRoot || 'C:\\Nexora Organized';
            const safeProposedDest = `${destRoot}\\${rec.relativeFolder.replace(/\//g, '\\')}\\${filename}`;
            const targetIdx = updatedProposals.findIndex((p) => p.id === item.id);
            if (targetIdx !== -1) {
              updatedProposals[targetIdx] = {
                ...updatedProposals[targetIdx],
                proposed_destination: safeProposedDest,
                rule_name: `🤖 ${rec.ruleName}`,
                warnings: [...(updatedProposals[targetIdx].warnings || []), ...rec.warnings],
              };
              enhancedCount++;
            }
          }
        } catch (itemErr: any) {
          console.warn(`LLM failed for item ${filename}:`, itemErr.message);
        }
      }

      setProposals(updatedProposals);
      toast.success(
        `Enhanced ${enhancedCount} proposal destinations via local LLM reasoning.`,
        'LLM Organization Proposals'
      );
    } catch (err) {
      console.error('LLM organization failed:', err);
      toast.error(err instanceof Error ? err.message : String(err), 'LLM Proposal Failed');
    } finally {
      setIsGeneratingLlmProposals(false);
    }
  }

  async function handleRunScanPipeline() {
    setRunningPipeline(true);
    try {
      toast.info('Analyzing files across Filenames, Metadata & Confirmed People...', 'Engine Active');
      const res = await api().organizer.runAutoPipeline(undefined, destinationRoot || undefined);
      const generatedCount = res.proposalSummary?.totalFiles ?? res.proposalsGenerated ?? 0;
      toast.success(
        `Generated ${generatedCount} organization proposals.${res.executed ? ' Automatically executed safe copy.' : ''}`,
        'Analysis Complete'
      );
      await loadData();
    } catch (err) {
      console.error('Failed to run pipeline:', err);
      toast.error(err instanceof Error ? err.message : String(err), 'Pipeline Error');
    } finally {
      setRunningPipeline(false);
    }
  }

  async function handleChooseDestination() {
    try {
      const folder = await api().dialog.openFolder();
      if (folder) {
        setDestinationRoot(folder);
      }
    } catch (err) {
      console.error('Failed to select destination folder:', err);
    }
  }

  async function handleExecuteOrganization() {
    if (proposals.length === 0) {
      toast.warning('No proposals available to organize.', 'Nothing to do');
      return;
    }

    setExecuting(true);
    try {
      toast.info('Starting verified safe copy operation...', 'Organizing Files');
      const result = await api().organizer.execute(proposals, destinationRoot || undefined);

      if (result.success) {
        toast.success(
          `Successfully organized ${result.completedFiles} files to destination. Source files preserved safely.`,
          'Organization Complete'
        );
        await loadData();
      } else {
        const errorDetail = result.errors && result.errors.length > 0 ? `: ${result.errors[0].error}` : '';
        toast.error(
          `Completed ${result.completedFiles} files with ${result.failedFiles} error(s)${errorDetail}.`,
          'Organization Partial'
        );
        await loadData();
      }
    } catch (err) {
      console.error('Organization failed:', err);
      toast.error(err instanceof Error ? err.message : String(err), 'Organization Error');
    } finally {
      setExecuting(false);
    }
  }

  // Filter proposals
  const filtered = proposals.filter((p) => {
    if (selectedCategory !== 'all') {
      const ruleName = (p.rule_name || '').toLowerCase();
      if (selectedCategory === 'filename' && !ruleName.includes('file') && !ruleName.includes('title')) return false;
      if (selectedCategory === 'metadata' && !ruleName.includes('date') && !ruleName.includes('camera') && !ruleName.includes('document')) return false;
      if (selectedCategory === 'people' && !ruleName.includes('person') && !ruleName.includes('people')) return false;
    }
    if (filterQuery.trim()) {
      const q = filterQuery.toLowerCase();
      return (
        p.source_path.toLowerCase().includes(q) ||
        p.proposed_destination.toLowerCase().includes(q) ||
        (p.rule_name && p.rule_name.toLowerCase().includes(q))
      );
    }
    return true;
  });

  const totalBytes = proposals.reduce((acc, cur) => acc + (cur.file_size || 0), 0);
  const warningCount = proposals.filter((p) => p.warnings && p.warnings.length > 0).length;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', gap: 'var(--space-4)', padding: 'var(--space-6)', overflowY: 'auto' }}>
      {/* Header Banner */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 'var(--space-4)' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
            <span style={{ fontSize: '24px' }}>🪄</span>
            <h1 style={{ fontSize: 'var(--font-size-2xl)', fontWeight: 700, margin: 0, color: 'var(--color-text-primary)' }}>
              Automatic File Organization
            </h1>
          </div>
          <p style={{ margin: 'var(--space-1) 0 0 0', color: 'var(--color-text-secondary)', fontSize: 'var(--font-size-sm)', maxWidth: '720px' }}>
            Nexora uses three intelligence streams—<strong>Filename patterns</strong>, <strong>Metadata (EXIF/Docs/Media)</strong>, and <strong>Confirmed People</strong>—to automatically propose structured destination hierarchies without risking your original files.
          </p>
        </div>

        {/* Action Buttons */}
        <div style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center' }}>
          <button
            className="btn btn-secondary"
            onClick={handleRunScanPipeline}
            disabled={runningPipeline || executing || isGeneratingLlmProposals}
            style={{ display: 'flex', alignItems: 'center', gap: '6px' }}
          >
            {runningPipeline ? <span className="spinner-border spinner-border-sm" /> : '⚡'}
            <span>{runningPipeline ? 'Analyzing Folders...' : 'Recalculate Proposals'}</span>
          </button>
          <button
            className="btn btn-secondary"
            onClick={handleGenerateLlmProposals}
            disabled={runningPipeline || executing || isGeneratingLlmProposals || proposals.length === 0}
            title="Reason with local Qwen3 4B on Ollama to optimize folder taxonomy and hierarchies"
            style={{ display: 'flex', alignItems: 'center', gap: '6px', borderColor: 'rgba(180, 255, 50, 0.4)', color: 'var(--color-accent)' }}
          >
            {isGeneratingLlmProposals ? <span className="spinner-border spinner-border-sm" /> : '🤖'}
            <span>{isGeneratingLlmProposals ? 'LLM Reasoning...' : 'LLM Smart Taxonomy'}</span>
          </button>
          <button
            className="btn btn-primary"
            onClick={handleExecuteOrganization}
            disabled={executing || runningPipeline || isGeneratingLlmProposals || proposals.length === 0}
            style={{ display: 'flex', alignItems: 'center', gap: '6px' }}
          >
            {executing ? <span className="spinner-border spinner-border-sm" /> : '✓'}
            <span>{executing ? 'Organizing Files...' : `Apply Organization (${proposals.length})`}</span>
          </button>
        </div>
      </div>

      {/* Destination Configuration Card */}
      <div
        style={{
          background: 'var(--color-surface)',
          border: '1px solid var(--color-border)',
          borderRadius: 'var(--radius-lg)',
          padding: 'var(--space-4)',
          display: 'flex',
          flexDirection: 'column',
          gap: 'var(--space-3)',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 'var(--space-2)' }}>
          <div>
            <div style={{ fontSize: 'var(--font-size-xs)', textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--color-text-tertiary)', fontWeight: 600 }}>
              Destination Target
            </div>
            <div style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-primary)', fontFamily: 'var(--font-mono)', marginTop: '2px' }}>
              {destinationRoot || 'Default: %USERPROFILE%\\Nexora Organized'}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 'var(--space-3)', alignItems: 'center' }}>
            <button className="btn btn-sm btn-secondary" onClick={handleChooseDestination}>
              Change Destination Folder
            </button>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: 'var(--font-size-xs)', color: 'var(--color-accent)', fontWeight: 600 }}>
              🛡️ Safe Copy Guarantee: Original files are never modified or deleted
            </div>
          </div>
        </div>
      </div>

      {/* Metrics Row */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 'var(--space-3)' }}>
        <div style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', padding: 'var(--space-3)' }}>
          <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-tertiary)' }}>Pending Proposals</div>
          <div style={{ fontSize: 'var(--font-size-xl)', fontWeight: 700, color: 'var(--color-text-primary)', marginTop: '4px' }}>
            {proposals.length}
          </div>
        </div>
        <div style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', padding: 'var(--space-3)' }}>
          <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-tertiary)' }}>Total Proposed Volume</div>
          <div style={{ fontSize: 'var(--font-size-xl)', fontWeight: 700, color: 'var(--color-accent)', marginTop: '4px' }}>
            {formatSize(totalBytes)}
          </div>
        </div>
        <div style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', padding: 'var(--space-3)' }}>
          <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-tertiary)' }}>Active Rules Configured</div>
          <div style={{ fontSize: 'var(--font-size-xl)', fontWeight: 700, color: 'var(--color-text-primary)', marginTop: '4px' }}>
            {rules.length}
          </div>
        </div>
        <div style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', padding: 'var(--space-3)' }}>
          <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-tertiary)' }}>Collision Warnings</div>
          <div style={{ fontSize: 'var(--font-size-xl)', fontWeight: 700, color: warningCount > 0 ? '#ffb300' : 'var(--color-text-secondary)', marginTop: '4px' }}>
            {warningCount}
          </div>
        </div>
      </div>

      {/* Filters & Search */}
      <div style={{ display: 'flex', gap: 'var(--space-3)', alignItems: 'center', flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', gap: 'var(--space-1)', background: 'var(--color-surface)', padding: '2px', borderRadius: 'var(--radius-md)', border: '1px solid var(--color-border)' }}>
          {(['all', 'metadata', 'filename', 'people'] as const).map((cat) => (
            <button
              key={cat}
              className={`btn btn-sm ${selectedCategory === cat ? 'btn-primary' : 'btn-ghost'}`}
              onClick={() => setSelectedCategory(cat)}
              style={{ textTransform: 'capitalize' }}
            >
              {cat === 'all' ? 'All Intelligence' : cat}
            </button>
          ))}
        </div>

        <input
          type="text"
          placeholder="Filter proposals by path, destination, or rule..."
          value={filterQuery}
          onChange={(e) => setFilterQuery(e.target.value)}
          style={{
            flex: 1,
            minWidth: '220px',
            height: '32px',
            fontSize: 'var(--font-size-xs)',
            background: 'var(--color-surface)',
            border: '1px solid var(--color-border)',
            borderRadius: 'var(--radius-md)',
            padding: '0 var(--space-3)',
            color: 'var(--color-text-primary)',
          }}
        />
      </div>

      {/* Proposals Table */}
      <div
        style={{
          flex: 1,
          background: 'var(--color-surface)',
          border: '1px solid var(--color-border)',
          borderRadius: 'var(--radius-lg)',
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
          minHeight: '320px',
        }}
      >
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: '1.2fr 1.6fr 120px 100px 90px',
            padding: 'var(--space-3) var(--space-4)',
            background: 'rgba(255, 255, 255, 0.02)',
            borderBottom: '1px solid var(--color-border)',
            fontSize: 'var(--font-size-xs)',
            fontWeight: 600,
            color: 'var(--color-text-tertiary)',
            textTransform: 'uppercase',
            letterSpacing: '0.05em',
          }}
        >
          <div>Original Source File</div>
          <div>Proposed Destination</div>
          <div>Classification Rule</div>
          <div>Size</div>
          <div>Status</div>
        </div>

        <div style={{ flex: 1, overflowY: 'auto' }}>
          {loading ? (
            <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '200px', color: 'var(--color-text-tertiary)' }}>
              Loading organization proposals...
            </div>
          ) : filtered.length === 0 ? (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '220px', gap: 'var(--space-2)', color: 'var(--color-text-tertiary)' }}>
              <span style={{ fontSize: '32px' }}>📂</span>
              <div style={{ fontSize: 'var(--font-size-sm)', fontWeight: 500 }}>No organization proposals pending</div>
              <div style={{ fontSize: 'var(--font-size-xs)', maxWidth: '400px', textAlign: 'center' }}>
                Add or scan a source folder, or click "Recalculate Proposals" above to analyze your indexed library.
              </div>
            </div>
          ) : (
            filtered.map((item, idx) => (
              <div
                key={item.id || idx}
                style={{
                  display: 'grid',
                  gridTemplateColumns: '1.2fr 1.6fr 120px 100px 90px',
                  padding: 'var(--space-3) var(--space-4)',
                  borderBottom: '1px solid rgba(255, 255, 255, 0.04)',
                  fontSize: 'var(--font-size-xs)',
                  alignItems: 'center',
                }}
              >
                <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', paddingRight: 'var(--space-2)' }} title={item.source_path}>
                  <span style={{ color: 'var(--color-text-primary)' }}>{item.source_path.split(/[\\/]/).pop()}</span>
                  <div style={{ fontSize: '11px', color: 'var(--color-text-tertiary)', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {item.source_path}
                  </div>
                </div>

                <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', paddingRight: 'var(--space-2)' }} title={item.proposed_destination}>
                  <span style={{ color: 'var(--color-accent)', fontFamily: 'var(--font-mono)' }}>
                    {item.proposed_destination}
                  </span>
                </div>

                <div style={{ color: 'var(--color-text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {item.rule_name || 'Standard Rule'}
                </div>

                <div style={{ color: 'var(--color-text-secondary)' }}>
                  {formatSize(item.file_size || 0)}
                </div>

                <div>
                  <span
                    style={{
                      display: 'inline-block',
                      padding: '2px 8px',
                      borderRadius: 'var(--radius-full)',
                      fontSize: '10px',
                      fontWeight: 600,
                      background: item.warnings && item.warnings.length > 0 ? 'rgba(255, 179, 0, 0.15)' : 'rgba(0, 230, 153, 0.12)',
                      color: item.warnings && item.warnings.length > 0 ? '#ffb300' : 'var(--color-accent)',
                    }}
                  >
                    {item.warnings && item.warnings.length > 0 ? 'Collision' : 'Ready'}
                  </span>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
};
