const initializeExternalLinkFavicons = () => {
  document.querySelectorAll('img[data-favicon-candidates]').forEach((image) => {
    let candidates;
    try {
      candidates = JSON.parse(image.dataset.faviconCandidates || '[]');
    } catch {
      candidates = [];
    }

    if (!Array.isArray(candidates) || candidates.length === 0) {
      image.hidden = true;
      return;
    }

    let candidateIndex = Math.max(0, candidates.indexOf(image.currentSrc || image.src));
    const tryNextCandidate = () => {
      candidateIndex += 1;
      if (candidateIndex < candidates.length) {
        image.src = candidates[candidateIndex];
      } else {
        image.hidden = true;
      }
    };

    image.addEventListener('error', tryNextCandidate);
    if (image.complete && image.naturalWidth === 0) tryNextCandidate();
  });
};

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initializeExternalLinkFavicons, { once: true });
} else {
  initializeExternalLinkFavicons();
}
