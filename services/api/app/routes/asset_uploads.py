from fastapi import HTTPException, UploadFile

from app.models import AssetUpload
from app.models.requests import ALLOWED_ASSET_CONTENT_TYPE, MAX_ASSET_BYTES


async def read_text_asset_upload(file: UploadFile) -> AssetUpload:
    """Read a bounded plain-text upload without retaining arbitrary file content."""
    if file.content_type != ALLOWED_ASSET_CONTENT_TYPE:
        raise HTTPException(status_code=422, detail="Only text/plain assets are supported")

    content = await file.read(MAX_ASSET_BYTES + 1)
    if len(content) > MAX_ASSET_BYTES:
        raise HTTPException(status_code=422, detail="Asset must not exceed 256 KiB")
    if b"\x00" in content:
        raise HTTPException(status_code=422, detail="Asset must contain valid UTF-8 text")
    try:
        content.decode("utf-8")
    except UnicodeDecodeError as error:
        raise HTTPException(
            status_code=422, detail="Asset must contain valid UTF-8 text"
        ) from error

    return AssetUpload(
        filename=file.filename or "asset.txt",
        content_type=ALLOWED_ASSET_CONTENT_TYPE,
        content=content,
    )
