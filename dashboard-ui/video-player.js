// Real Video Player Streaming Engine

window.openVideoPlayer = function(videoFilename) {
    const modal = document.getElementById('video-modal');
    const title = document.getElementById('modal-title');
    const container = document.getElementById('video-container');
    
    title.innerText = `Playback Artifact: ${videoFilename}`;
    
    // Show streaming video player
    container.innerHTML = `
        <div style="width: 100%; display: flex; flex-direction: column; align-items: center; gap: 12px;">
            <div id="video-wrapper" style="width: 100%; position: relative;">
                <video id="qa-video" controls autoplay width="100%" style="border-radius: 12px; background: #000; max-height: 400px;">
                    <source src="/api/videos/${encodeURIComponent(videoFilename)}" type="video/webm">
                    <source src="/api/videos/${encodeURIComponent(videoFilename)}" type="video/mp4">
                    Your browser does not support HTML5 video streaming.
                </video>
                <div id="video-error" style="display: none; width: 100%; height: 300px; background: #f8fafc; border: 2px dashed #cbd5e1; border-radius: 12px; flex-direction: column; align-items: center; justify-content: center; color: #475569; font-weight: 500;">
                    <svg style="width: 48px; height: 48px; color: #94a3b8; margin-bottom: 12px;" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z"></path></svg>
                    <span style="font-size: 1.1rem; color: #334155; margin-bottom: 4px;">Video Artifact Not Found</span>
                    <span style="font-size: 0.9rem; color: #64748b;">The recording has expired or was not generated for this test run.</span>
                </div>
            </div>
            <div style="display: flex; gap: 12px; width: 100%; justify-content: space-between; align-items: center; padding: 8px 4px;">
                <span style="font-size: 0.85rem; color: #94a3b8; font-weight: 600;">Stream Source: /api/videos/${videoFilename}</span>
                <a href="/api/videos/${encodeURIComponent(videoFilename)}" download class="watch-btn" style="text-decoration: none;">Download Video File</a>
            </div>
        </div>
    `;

    // Add error listener to video
    const videoElem = document.getElementById('qa-video');
    const errorElem = document.getElementById('video-error');
    if (videoElem) {
        // Source tags fire error events if they fail to load
        const sources = videoElem.querySelectorAll('source');
        let failedSources = 0;
        sources.forEach(source => {
            source.addEventListener('error', () => {
                failedSources++;
                if (failedSources === sources.length) {
                    videoElem.style.display = 'none';
                    errorElem.style.display = 'flex';
                }
            });
        });
    }
    
    modal.classList.remove('hidden');
};

document.addEventListener('DOMContentLoaded', () => {
    const modal = document.getElementById('video-modal');
    const closeBtn = document.getElementById('close-modal');
    
    if (closeBtn) {
        closeBtn.addEventListener('click', () => {
            const videoElement = modal.querySelector('video');
            if (videoElement) videoElement.pause();
            modal.classList.add('hidden');
        });
    }

    if (modal) {
        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                const videoElement = modal.querySelector('video');
                if (videoElement) videoElement.pause();
                modal.classList.add('hidden');
            }
        });
    }
});
