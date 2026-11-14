import os
from langchain_community.document_loaders import TextLoader
from langchain_text_splitters import RecursiveCharacterTextSplitter
from langchain_chroma import Chroma
from langchain_huggingface import HuggingFaceEmbeddings

def ingest_psi_metadata():
    papers_dir = "papers"
    docs = []

    # Recursively walk through all unzipped PSI folders
    for root, dirs, files in os.walk(papers_dir):
        for file in files:
            file_path = os.path.join(root, file)
            
            # INGESTION RULE: Keep investigation/metadata text files, skip sample templates
            if file.startswith("i_") and file.endswith(".txt"):
                try:
                    loader = TextLoader(file_path, encoding="utf-8", autodetect_encoding=True)
                    docs.extend(loader.load())
                    print(f"Loaded investigation metadata: {file}")
                except Exception as e:
                    print(f"Error loading {file}: {e}")
            elif file.endswith((".pdf", ".md")):
                # Keep your PDF and markdown loaders here as well
                pass

    if not docs:
        print("No valid investigation files found.")
        return

    # Split into clean chunks
    text_splitter = RecursiveCharacterTextSplitter(
        chunk_size=1000,
        chunk_overlap=200,
    )
    splits = text_splitter.split_documents(docs)
    print(f"Generated {len(splits)} chunks from investigation metadata.")

    # Upsert into ChromaDB collection 'langchain'
    embeddings = HuggingFaceEmbeddings(model_name="all-MiniLM-L6-v2")
    vectorstore = Chroma.from_documents(
        documents=splits,
        embedding=embeddings,
        persist_directory="chroma_db",
        collection_name="langchain"
    )
    print("PSI investigation metadata successfully ingested into ChromaDB!")

if __name__ == "__main__":
    ingest_psi_metadata()