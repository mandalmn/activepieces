import { isNil } from '@activepieces/core-utils'
import { ToolResolutionConfidence, WorkflowStepKind } from '@activepieces/shared'
import { coreTools } from './core-tool-bindings'
import { nameScore, ToolCandidate } from './tool-candidate-search'

const HIGH_SCORE = 55
const MEDIUM_SCORE = 30
const HIGH_MARGIN = 12
const MAX_FREE_REQUIRED_PROPERTIES = 3

const READ_CLASSIFICATIONS: ReadonlySet<string> = new Set(['READ', 'SEARCH'])
const WRITE_CLASSIFICATIONS: ReadonlySet<string> = new Set(['WRITE', 'DESTRUCTIVE'])

export const candidateRanking = {
    rank({ candidates, intentTokens, stepKind }: RankParams): ScoredCandidate[] {
        return candidates
            .map((candidate) => ({ candidate, ...scoreOf({ candidate, intentTokens, stepKind }) }))
            .sort((left, right) => right.score - left.score)
    },

    confidenceOf({ ranked }: { ranked: ScoredCandidate[] }): ToolResolutionConfidence {
        const [top, runnerUp] = ranked
        if (isNil(top)) {
            return ToolResolutionConfidence.LOW
        }
        const margin = top.score - (runnerUp?.score ?? 0)
        if (top.score >= HIGH_SCORE && margin >= HIGH_MARGIN) {
            return ToolResolutionConfidence.HIGH
        }
        if (top.score >= MEDIUM_SCORE) {
            return ToolResolutionConfidence.MEDIUM
        }
        return ToolResolutionConfidence.LOW
    },
}

function scoreOf({ candidate, intentTokens, stepKind }: ScoreParams): { score: number, signals: string[] } {
    const contributions = [
        namedMatch({ candidate }),
        semanticRelevance({ candidate }),
        textOverlap({ candidate, intentTokens }),
        connectionFit({ candidate }),
        classificationFit({ candidate, stepKind }),
        genericPenalty({ candidate }),
        setupBurden({ candidate }),
    ]
    return {
        score: contributions.reduce((total, contribution) => total + contribution.points, 0),
        signals: contributions.filter((contribution) => contribution.points !== 0).map((contribution) => `${contribution.name}:${contribution.points}`),
    }
}

function namedMatch({ candidate }: { candidate: ToolCandidate }): Contribution {
    return { name: 'named', points: nameScore({ signals: candidate.signals, base: 24, span: 24 }) }
}

function semanticRelevance({ candidate }: { candidate: ToolCandidate }): Contribution {
    const { cosine, semanticRank } = candidate.signals
    if (!isNil(cosine)) {
        return { name: 'cosine', points: Math.round(cosine * 30) }
    }
    if (!isNil(semanticRank)) {
        return { name: 'semanticRank', points: Math.max(0, 18 - semanticRank * 2) }
    }
    return { name: 'cosine', points: 0 }
}

function textOverlap({ candidate, intentTokens }: { candidate: ToolCandidate, intentTokens: string[] }): Contribution {
    if (intentTokens.length === 0) {
        return { name: 'overlap', points: 0 }
    }
    const haystack = new Set(`${candidate.objectDisplayName} ${candidate.objectDescription}`
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter((token) => token.length >= 3))
    const hits = intentTokens.filter((token) => haystack.has(token)).length
    return { name: 'overlap', points: Math.min(hits, 4) * 8 }
}

function connectionFit({ candidate }: { candidate: ToolCandidate }): Contribution {
    if (candidate.connectionAvailable) {
        return { name: 'connected', points: 14 }
    }
    return { name: 'needsConnection', points: candidate.requiresConnection ? -6 : 0 }
}

function classificationFit({ candidate, stepKind }: { candidate: ToolCandidate, stepKind: WorkflowStepKind | null }): Contribution {
    const { classification } = candidate
    if (isNil(classification) || isNil(stepKind)) {
        return { name: 'classification', points: 0 }
    }
    const wantsRead = stepKind === WorkflowStepKind.FETCH || stepKind === WorkflowStepKind.CONDITION
    const wantsWrite = stepKind === WorkflowStepKind.OUTPUT
    if (wantsRead) {
        return { name: 'classification', points: READ_CLASSIFICATIONS.has(classification) ? 10 : -12 }
    }
    if (wantsWrite) {
        return { name: 'classification', points: WRITE_CLASSIFICATIONS.has(classification) ? 10 : -12 }
    }
    return { name: 'classification', points: 0 }
}

function genericPenalty({ candidate }: { candidate: ToolCandidate }): Contribution {
    return { name: 'generic', points: coreTools.isGeneric({ pieceName: candidate.pieceName }) ? -25 : 0 }
}

function setupBurden({ candidate }: { candidate: ToolCandidate }): Contribution {
    const excess = Math.max(0, candidate.requiredProperties.length - MAX_FREE_REQUIRED_PROPERTIES)
    return { name: 'setup', points: -Math.min(excess, 5) }
}

type Contribution = {
    name: string
    points: number
}

type ScoreParams = {
    candidate: ToolCandidate
    intentTokens: string[]
    stepKind: WorkflowStepKind | null
}

type RankParams = {
    candidates: ToolCandidate[]
    intentTokens: string[]
    stepKind: WorkflowStepKind | null
}

export type ScoredCandidate = {
    candidate: ToolCandidate
    score: number
    signals: string[]
}
